//! Replays the games recorded from the TypeScript engine (`fixtures/`) and compares every result
//! as JSON values: key order does not matter, `null` versus a missing key does.
//!
//! The recordings: generator values, deals, nine bot games with every state and every seat's view
//! (log, summaries and deck as lengths; the final state in full), the 180 games of the old
//! "random full games" test with their final state, and one save file written mid-game.
//! The games include skips (`"skip": true`) for absent players.
//!
//! `BLESS=1 cargo test -p engine --test fixtures` rewrites the expected results from this engine,
//! for a deliberate rule change; review the diff.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::panic,
    clippy::case_sensitive_file_extension_comparisons
)]

use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;

use engine::{Action, GameState, apply_action, apply_skip, new_game, rng, view_for};
use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use serde::Deserialize;
use serde_json::{Map, Value, json};

fn path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures").join(name)
}

fn bless() -> bool {
    std::env::var_os("BLESS").is_some()
}

fn read(name: &str) -> Value {
    let bytes = fs::read(path(name)).unwrap();
    let text = if name.ends_with(".gz") {
        let mut text = String::new();
        GzDecoder::new(bytes.as_slice()).read_to_string(&mut text).unwrap();
        text
    } else {
        String::from_utf8(bytes).unwrap()
    };
    serde_json::from_str(&text).unwrap()
}

fn write(name: &str, data: &Value) {
    let text = serde_json::to_string(data).unwrap() + "\n";
    if name.ends_with(".gz") {
        let mut gz = GzEncoder::new(Vec::new(), Compression::best());
        gz.write_all(text.as_bytes()).unwrap();
        fs::write(path(name), gz.finish().unwrap()).unwrap();
    } else {
        fs::write(path(name), text).unwrap();
    }
}

/// Compares, or with `BLESS` replaces the expected value.
fn check(expected: &mut Value, actual: Value, what: &str) {
    if bless() {
        *expected = actual;
    } else {
        assert!(
            *expected == actual,
            "{what} differs\nexpected: {expected}\n  actual: {actual}"
        );
    }
}

#[derive(Deserialize)]
struct Move {
    seat: u8,
    action: Option<Action>,
    #[serde(default)]
    skip: bool,
}

fn replay(n: u8, seed: u32, moves: &Value, mut each: impl FnMut(usize, &GameState)) -> GameState {
    let moves: Vec<Move> = serde_json::from_value(moves.clone()).unwrap();
    let mut s = new_game(n, seed).unwrap();
    for (i, m) in moves.iter().enumerate() {
        s = match (&m.action, m.skip) {
            (_, true) => apply_skip(&s, m.seat),
            (Some(action), false) => apply_action(&s, m.seat, action),
            (None, false) => panic!("move {i} has neither an action nor skip"),
        }
        .unwrap_or_else(|e| panic!("n={n} seed={seed} move {i}: {e}"));
        each(i, &s);
    }
    assert!(s.over, "n={n} seed={seed}: the game did not finish");
    s
}

/// Leaves out the parts that only grow (log, summaries) or shrink (deck), keeping their lengths,
/// the way the recorder does.
fn step(value: Value) -> Value {
    let mut map: Map<String, Value> = serde_json::from_value(value).unwrap();
    for (key, length) in [
        ("log", "logLength"),
        ("summaries", "summariesLength"),
        ("deck", "deckLength"),
    ] {
        if let Some(Value::Array(items)) = map.remove(key) {
            map.insert(length.into(), json!(items.len()));
        }
    }
    Value::Object(map)
}

fn without_log(value: Value) -> Value {
    let mut map: Map<String, Value> = serde_json::from_value(value).unwrap();
    if let Some(Value::Array(log)) = map.remove("log") {
        map.insert("logLength".into(), json!(log.len()));
    }
    Value::Object(map)
}

#[test]
fn rng_matches() {
    let mut data = read("rng.json");
    for case in data.as_array_mut().unwrap() {
        let mut r = rng(u32::try_from(case["seed"].as_u64().unwrap()).unwrap());
        let values: Vec<f64> = (0..20).map(|_| r()).collect();
        check(&mut case["values"], json!(values), "rng values");
    }
    if bless() {
        write("rng.json", &data);
    }
}

#[test]
fn deals_match() {
    let mut data = read("deal.json");
    for case in data.as_array_mut().unwrap() {
        let n = u8::try_from(case["n"].as_u64().unwrap()).unwrap();
        let seed = u32::try_from(case["seed"].as_u64().unwrap()).unwrap();
        let state = serde_json::to_value(new_game(n, seed).unwrap()).unwrap();
        check(&mut case["state"], state, &format!("deal n={n} seed={seed}"));
    }
    if bless() {
        write("deal.json", &data);
    }
}

/// Every state and every seat's view along nine games.
#[test]
fn full_games_match() {
    let mut data = read("games-full.json.gz");
    for game in data.as_array_mut().unwrap() {
        let n = u8::try_from(game["n"].as_u64().unwrap()).unwrap();
        let seed = u32::try_from(game["seed"].as_u64().unwrap()).unwrap();
        let mut steps = Vec::new();
        let last = replay(n, seed, &game["moves"], |_, s| {
            let seats = (0..n).map(Some).chain([None]);
            let views: Vec<Value> = seats
                .map(|seat| step(serde_json::to_value(view_for(s, seat)).unwrap()))
                .collect();
            steps.push(json!({ "state": step(serde_json::to_value(s).unwrap()), "views": views }));
        });
        if bless() {
            game["steps"] = json!(steps);
        } else {
            let expected = game["steps"].as_array().unwrap();
            assert_eq!(expected.len(), steps.len(), "n={n} seed={seed}: number of moves");
            for (i, (expected, actual)) in expected.iter().zip(steps).enumerate() {
                assert!(
                    *expected == actual,
                    "n={n} seed={seed} after move {i}\nexpected: {expected}\n  actual: {actual}"
                );
            }
        }
        check(
            &mut game["state"],
            serde_json::to_value(last).unwrap(),
            &format!("n={n} seed={seed} final state"),
        );
    }
    if bless() {
        write("games-full.json.gz", &data);
    }
}

/// The 180 games of the old "random full games" test: moves and the final state.
#[test]
fn final_states_match() {
    let mut data = read("games-final.json.gz");
    assert_eq!(data.as_array().unwrap().len(), 180);
    for game in data.as_array_mut().unwrap() {
        let n = u8::try_from(game["n"].as_u64().unwrap()).unwrap();
        let seed = u32::try_from(game["seed"].as_u64().unwrap()).unwrap();
        let last = replay(n, seed, &game["moves"], |_, _| {});
        assert_eq!(last.round, 4);
        assert_eq!(last.summaries.len(), 4);
        assert_ne!(last.winners.len(), 0);
        let actual = without_log(serde_json::to_value(last).unwrap());
        check(&mut game["state"], actual, &format!("n={n} seed={seed} final state"));
    }
    if bless() {
        write("games-final.json.gz", &data);
    }
}
