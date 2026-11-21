//! A room that plays Pahunch (its theme's game): moves, the vote clock, the room file, ending early
//! and the board pick, message by message.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::needless_pass_by_value,
    clippy::assert_is_empty
)]

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use pahunch::{LogEntry, View};
use serde_json::{Value, json};
use server::games::AnyView;
use server::protocol::{RoomInfo, ServerMsg};
use server::rooms::{ClientId, Options, Rooms};

struct Fake {
    id: ClientId,
    got: Arc<Mutex<Vec<ServerMsg>>>,
}

fn fake(rooms: &mut Rooms, ip: &str) -> Fake {
    let got = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&got);
    let id = rooms.connect(
        ip.into(),
        Box::new(move |m: &ServerMsg| {
            sink.lock().unwrap().push(m.clone());
            true
        }),
    );
    Fake { id, got }
}

fn send(rooms: &mut Rooms, c: &Fake, msg: Value) {
    rooms.handle_text(c.id, &msg.to_string());
}

fn last_state(c: &Fake) -> (RoomInfo, Option<AnyView>) {
    let got = c.got.lock().unwrap();
    got.iter()
        .rev()
        .find_map(|m| match m {
            ServerMsg::State { room, game, .. } => Some((room.clone(), game.clone())),
            _ => None,
        })
        .expect("a state message")
}

fn room(c: &Fake) -> RoomInfo {
    last_state(c).0
}

fn view(c: &Fake) -> View {
    last_state(c).1.and_then(AnyView::into_pahunch).expect("a Pahunch view")
}

fn last_error(c: &Fake) -> Option<String> {
    match c.got.lock().unwrap().last() {
        Some(ServerMsg::Error { message, .. }) => Some(message.clone()),
        _ => None,
    }
}

fn joined_code(c: &Fake) -> String {
    let got = c.got.lock().unwrap();
    got.iter()
        .rev()
        .find_map(|m| match m {
            ServerMsg::Joined { room, .. } => Some(room.clone()),
            _ => None,
        })
        .expect("a joined message")
}

struct Table {
    rooms: Rooms,
    clients: Vec<Fake>,
    code: String,
    now: Arc<AtomicU64>,
}

fn options(now: &Arc<AtomicU64>, dir: Option<PathBuf>) -> Options {
    let read = Arc::clone(now);
    Options {
        now: Box::new(move || read.load(Ordering::SeqCst)),
        shuffle_seats: false,
        data_dir: dir,
        ..Options::default()
    }
}

/// A Society Committee room with `n` players, not started.
fn table(n: usize, dir: Option<PathBuf>) -> Table {
    let now = Arc::new(AtomicU64::new(1_000_000));
    let mut rooms = Rooms::new(options(&now, dir)).unwrap();
    let clients: Vec<Fake> = (0..n).map(|i| fake(&mut rooms, &format!("10.0.1.{}", i + 1))).collect();
    send(
        &mut rooms,
        &clients[0],
        json!({ "type": "create", "theme": "society-committee", "name": "P0" }),
    );
    let code = joined_code(&clients[0]);
    for (i, c) in clients.iter().enumerate().skip(1) {
        send(
            &mut rooms,
            c,
            json!({ "type": "join", "room": code, "name": format!("P{i}") }),
        );
    }
    Table {
        rooms,
        clients,
        code,
        now,
    }
}

impl Table {
    fn act(&mut self, seat: u8, action: Value) {
        let c = &self.clients[usize::from(seat)];
        send(&mut self.rooms, c, json!({ "type": "action", "action": action }));
        assert_eq!(last_error(c), None, "seat {seat}");
    }

    fn admin(&mut self, msg: Value) {
        send(&mut self.rooms, &self.clients[0], msg);
    }

    fn turn(&self) -> u8 {
        view(&self.clients[0]).turn
    }

    /// Seats from the one to move, round the table.
    fn order(&self) -> Vec<u8> {
        let t = self.turn();
        let n = u8::try_from(self.clients.len()).unwrap();
        (0..n).map(|k| (t + k) % n).collect()
    }

    /// The first in turn order climbs from room 3 (3 seats, 2 yes needed, a neutral there) with
    /// the second there: the second owes a vote.
    fn start_a_vote(&mut self) -> (u8, u8) {
        let o = self.order();
        self.act(o[0], json!({ "type": "enter", "room": 3 }));
        self.act(o[1], json!({ "type": "enter", "room": 3 }));
        self.act(o[2], json!({ "type": "enter", "room": 2 }));
        self.act(o[0], json!({ "type": "climb", "path": 11 }));
        assert_eq!(view(&self.clients[0]).pending, vec![o[1]]);
        (o[0], o[1])
    }
}

#[test]
fn a_society_committee_room_plays_pahunch() {
    let mut t = table(3, None);
    let info = room(&t.clients[0]);
    assert_eq!((info.min_players, info.max_players), (3, 7));
    assert_eq!(info.variant, Some(0));
    t.admin(json!({ "type": "start" }));
    let v = view(&t.clients[1]);
    assert_eq!((v.n, v.you, v.layout.board.as_str()), (3, Some(1), "full"));
    assert_eq!(v.players[1].tokens, Some(vec![1, 1]));
    assert_eq!(v.players[0].tokens, None, "others' points stay hidden");

    let mover = t.turn();
    let c = &t.clients[usize::from(mover)];
    send(
        &mut t.rooms,
        c,
        json!({ "type": "action", "action": { "type": "pass" } }),
    );
    assert_eq!(last_error(c).as_deref(), Some("Unknown move"), "an auction move");
    send(
        &mut t.rooms,
        c,
        json!({ "type": "action", "action": { "type": "climb", "path": "up" } }),
    );
    assert_eq!(last_error(c).as_deref(), Some("Bad message"));
    send(
        &mut t.rooms,
        c,
        json!({ "type": "action", "action": { "type": "enter", "room": 5 } }),
    );
    assert_eq!(last_error(c).as_deref(), Some("New climbers go into a bottom room"));
    t.act(mover, json!({ "type": "enter", "room": 0 }));
    assert_eq!(view(&t.clients[0]).rooms[0].last(), Some(&Some(mover)));
}

#[test]
fn a_vote_passes_on_a_yes_and_pays_the_voter() {
    let mut t = table(3, None);
    t.admin(json!({ "type": "start" }));
    let (mover, voter) = t.start_a_vote();
    t.act(voter, json!({ "type": "vote", "yes": 1 }));
    let v = view(&t.clients[usize::from(voter)]);
    assert!(v.vote.is_none());
    assert_eq!(v.rooms[9], vec![None, Some(mover)]);
    assert_eq!(v.players[usize::from(voter)].tokens, Some(vec![1, 1, 1]));
}

#[test]
fn the_vote_clock_says_no_for_whoever_did_not_answer() {
    let mut t = table(3, None);
    t.admin(json!({ "type": "timer", "seconds": 20, "extend": 5 }));
    t.admin(json!({ "type": "start" }));
    let (mover, voter) = t.start_a_vote();
    t.now.fetch_add(10_000, Ordering::SeqCst);
    t.rooms.tick();
    assert!(view(&t.clients[0]).vote.is_some());
    assert!(room(&t.clients[0]).bid_ms_left.is_some());
    t.now.fetch_add(11_000, Ordering::SeqCst);
    t.rooms.tick();
    let v = view(&t.clients[0]);
    assert!(v.vote.is_none());
    assert!(v.rooms[3].contains(&Some(mover)), "the climber stays");
    assert!(v.log.contains(&LogEntry::Vote {
        p: voter,
        yes: 0,
        of: 1
    }));
    assert_eq!(v.turn, mover, "the mover chooses another move");
    assert_eq!(v.tried, vec![3]);
}

#[test]
fn ending_early_shows_everything_and_crowns_nobody() {
    let mut t = table(3, None);
    t.admin(json!({ "type": "start" }));
    t.admin(json!({ "type": "end" }));
    let v = view(&t.clients[2]);
    assert!(v.over);
    assert!(v.winners.is_empty());
    assert!(v.players.iter().all(|p| p.tokens.is_some()));
    let info = room(&t.clients[2]);
    assert_eq!(info.games, 0, "a game without a winner is not in the series");
    assert!(info.seats.iter().all(|s| s.wins == 0));
}

#[test]
fn the_admin_picks_the_board_in_the_lobby() {
    let mut t = table(3, None);
    t.admin(json!({ "type": "variant", "variant": 1 }));
    assert_eq!(last_error(&t.clients[0]).as_deref(), Some("No such setup"));
    t.admin(json!({ "type": "variant", "variant": null }));
    assert_eq!(
        last_error(&t.clients[0]).as_deref(),
        Some("No such setup"),
        "one board: nothing to pick at random"
    );
    send(&mut t.rooms, &t.clients[1], json!({ "type": "variant", "variant": 0 }));
    assert!(last_error(&t.clients[1]).is_some_and(|e| e.contains("admin")));
    t.admin(json!({ "type": "variant", "variant": 0 }));
    assert_eq!(last_error(&t.clients[0]), None);
    t.admin(json!({ "type": "start" }));
    t.admin(json!({ "type": "variant", "variant": 0 }));
    assert_eq!(
        last_error(&t.clients[0]).as_deref(),
        Some("Pick the setup in the lobby")
    );
}

#[test]
fn the_admins_house_rules_reach_the_game() {
    let mut t = table(3, None);
    let mut settings = serde_json::to_value(&room(&t.clients[0]).settings).unwrap();
    settings["gameOptions"] = json!({ "failEndsTurn": true });
    t.admin(json!({ "type": "settings", "settings": settings }));
    assert_eq!(last_error(&t.clients[0]), None);
    assert_eq!(
        room(&t.clients[1]).settings.game_options.get("failEndsTurn"),
        Some(&true)
    );
    t.admin(json!({ "type": "start" }));
    let v = view(&t.clients[1]);
    assert!(v.options.fail_ends_turn);
    assert!(v.options.favours, "a missing option takes its default");
}

#[test]
fn a_running_vote_survives_a_restart() {
    let dir = std::env::temp_dir().join(format!("auction-adda-pahunch-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let before = {
        let mut t = table(3, Some(dir.clone()));
        t.admin(json!({ "type": "start" }));
        t.start_a_vote();
        t.rooms.flush();
        let file: Value = serde_json::from_slice(&fs::read(dir.join(format!("{}.json", t.code))).unwrap()).unwrap();
        assert_eq!(file["theme"], "society-committee");
        assert!(file["game"]["vote"].is_object());
        view(&t.clients[0])
    };
    let now = Arc::new(AtomicU64::new(2_000_000));
    let mut rooms = Rooms::new(options(&now, Some(dir.clone()))).unwrap();
    let c = fake(&mut rooms, "10.0.1.9");
    let code = fs::read_dir(&dir)
        .unwrap()
        .find_map(|e| {
            e.unwrap()
                .file_name()
                .into_string()
                .unwrap()
                .strip_suffix(".json")
                .map(str::to_owned)
        })
        .unwrap();
    send(&mut rooms, &c, json!({ "type": "join", "room": code }));
    let after = view(&c);
    assert_eq!(after.rooms, before.rooms);
    assert_eq!(after.vote, before.vote);
    let _ = fs::remove_dir_all(&dir);
}
