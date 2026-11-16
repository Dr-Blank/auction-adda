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

fn apply(s: &GameState, m: &Move) -> Result<GameState, engine::RuleError> {
    match (&m.action, m.skip) {
        (_, true) => apply_skip(s, m.seat),
        (Some(action), false) => apply_action(s, m.seat, action),
        (None, false) => panic!("a move has neither an action nor skip"),
    }
}

/// A move that keeps a re-blessed game going: skip whoever owes an auction move; with no auction,
/// the seller plays their first card (a skipped turn would only pass the turn on).
fn filler(s: &GameState) -> Move {
    let seat = engine::pending(s)[0];
    match s.players[usize::from(seat)].hand.first() {
        Some(card) if s.auction.is_none() => Move {
            seat,
            action: Some(Action::Play {
                card: card.id,
                second: None,
            }),
            skip: false,
        },
        _ => Move {
            seat,
            action: None,
            skip: true,
        },
    }
}

/// Plays the recorded moves. With `BLESS`, a rule change may make some of them illegal; the game is
/// then kept going and `moves` rewritten: an illegal move is dropped, except that a move refused
/// because an auction is still running first closes that auction with skips; a game that runs out
/// of moves is finished with skips.
fn replay(n: u8, seed: u32, moves: &mut Value, mut each: impl FnMut(usize, &GameState)) -> GameState {
    let recorded: Vec<Move> = serde_json::from_value(moves.clone()).unwrap();
    let mut s = new_game(n, seed).unwrap();
    let mut kept: Vec<Move> = Vec::new();
    let mut push = |s: &mut GameState, m: Move, kept: &mut Vec<Move>| {
        *s = apply(s, &m).unwrap();
        kept.push(m);
        each(kept.len() - 1, s);
    };
    for (i, m) in recorded.into_iter().enumerate() {
        if s.over {
            assert!(bless(), "n={n} seed={seed}: moves left after the game ended");
            break;
        }
        if apply(&s, &m).is_err() && bless() && m.action.as_ref().is_some_and(|a| matches!(a, Action::Play { .. })) {
            while s.auction.is_some() {
                let m = filler(&s);
                push(&mut s, m, &mut kept);
            }
        }
        match apply(&s, &m) {
            Ok(_) => push(&mut s, m, &mut kept),
            Err(_) if bless() => {}
            Err(e) => panic!("n={n} seed={seed} move {i}: {e}"),
        }
    }
    while bless() && !s.over {
        let m = filler(&s);
        push(&mut s, m, &mut kept);
    }
    assert!(s.over, "n={n} seed={seed}: the game did not finish");
    if bless() {
        *moves = json!(
            kept.iter()
                .map(|m| if m.skip {
                    json!({ "seat": m.seat, "skip": true })
                } else {
                    json!({ "seat": m.seat, "action": m.action })
                })
                .collect::<Vec<_>>()
        );
    }
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
        let last = replay(n, seed, &mut game["moves"], |_, s| {
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
        let last = replay(n, seed, &mut game["moves"], |_, _| {});
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
