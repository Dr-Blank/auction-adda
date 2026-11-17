//! Rooms, seats and persistence, driven message by message with a hand-moved clock. Ported from
//! the TypeScript server tests; same cases, same order.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::panic,
    clippy::needless_pass_by_value
)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use engine::{AuctionKind, AuctionType, LogEntry, View};
use serde_json::{Value, json};
use server::protocol::{ErrorCode, RoomInfo, ServerMsg};
use server::rooms::{ClientId, CreateLimit, Options, Rooms};

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

struct State {
    room: RoomInfo,
    you: Option<u8>,
    left: Option<u8>,
    game: Option<View>,
}

fn state(c: &Fake) -> State {
    let got = c.got.lock().unwrap();
    got.iter()
        .rev()
        .find_map(|m| match m {
            ServerMsg::State { room, you, left, game } => Some(State {
                room: room.clone(),
                you: *you,
                left: *left,
                game: game.clone(),
            }),
            _ => None,
        })
        .expect("a state message")
}

fn game(c: &Fake) -> View {
    state(c).game.expect("a game")
}

/// The last `joined`: room code, seat, token.
fn joined(c: &Fake) -> (String, Option<u8>, Option<String>) {
    let got = c.got.lock().unwrap();
    got.iter()
        .rev()
        .find_map(|m| match m {
            ServerMsg::Joined { room, seat, token } => Some((room.clone(), *seat, token.clone())),
            _ => None,
        })
        .expect("a joined message")
}

/// Every `notice` this client got, oldest first.
fn notices(c: &Fake) -> Vec<String> {
    let got = c.got.lock().unwrap();
    got.iter()
        .filter_map(|m| match m {
            ServerMsg::Notice { message } => Some(message.clone()),
            _ => None,
        })
        .collect()
}

fn last(c: &Fake) -> ServerMsg {
    c.got.lock().unwrap().last().cloned().expect("a message")
}

fn last_error(c: &Fake) -> Option<String> {
    match last(c) {
        ServerMsg::Error { message, .. } => Some(message),
        _ => None,
    }
}

fn assert_error(c: &Fake, part: &str) {
    let e = last_error(c);
    assert!(
        e.as_deref().is_some_and(|e| e.contains(part)),
        "expected an error with {part:?}, got {e:?}"
    );
}

/// A room with `n` seated players; returns the clients in seat order and the room code.
fn seated(rooms: &mut Rooms, n: usize) -> (Vec<Fake>, String) {
    let clients: Vec<Fake> = (0..n).map(|i| fake(rooms, &format!("10.0.0.{}", i + 1))).collect();
    send(
        rooms,
        &clients[0],
        json!({ "type": "create", "theme": "box-office", "name": "P0" }),
    );
    let code = joined(&clients[0]).0;
    for (i, c) in clients.iter().enumerate().skip(1) {
        send(
            rooms,
            c,
            json!({ "type": "join", "room": code, "name": format!("P{i}") }),
        );
    }
    (clients, code)
}

fn clock(start: u64) -> (Arc<AtomicU64>, Options) {
    let now = Arc::new(AtomicU64::new(start));
    let read = Arc::clone(&now);
    let opts = Options {
        now: Box::new(move || read.load(Ordering::SeqCst)),
        ..fixed()
    };
    (now, opts)
}

/// Seat numbers stay as joined when a game starts, so a test knows who sits where.
fn fixed() -> Options {
    Options {
        shuffle_seats: false,
        ..Options::default()
    }
}

fn advance(now: &AtomicU64, ms: u64) {
    now.fetch_add(ms, Ordering::SeqCst);
}

/// A directory that is removed when the test ends.
struct TmpDir(PathBuf);

impl TmpDir {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("auction-adda-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    fn files(&self) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(&self.0)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        names
    }
}

impl Drop for TmpDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn rooms_in(dir: &Path, opts: Options) -> Rooms {
    Rooms::new(Options {
        data_dir: Some(dir.to_owned()),
        ..opts
    })
    .unwrap()
}

#[test]
fn lobby_join_leave_start_needs_3_to_5_players() {
    let mut rooms = Rooms::new(fixed()).unwrap();
    let (clients, code) = seated(&mut rooms, 2);
    assert!(code.len() == 6 && code.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit()));
    let names: Vec<String> = state(&clients[1]).room.seats.iter().map(|s| s.name.clone()).collect();
    assert_eq!(names, ["P0", "P1"]);
    send(&mut rooms, &clients[0], json!({ "type": "start" }));
    assert_error(&clients[0], "3–5");

    let c = fake(&mut rooms, "10.0.0.1");
    let name = "  Third\u{7} player with a very long name  ";
    send(
        &mut rooms,
        &c,
        json!({ "type": "join", "room": code.to_lowercase(), "name": name }),
    );
    assert_eq!(state(&c).room.seats[2].name, "Third player with a");
    assert_eq!(state(&c).you, Some(2));

    // seat 1 leaves: seat 2 moves down to seat 1 and keeps working
    send(&mut rooms, &clients[1], json!({ "type": "leave" }));
    assert_eq!(state(&c).you, Some(1));
    assert_eq!(state(&clients[1]).you, None);
    send(
        &mut rooms,
        &clients[1],
        json!({ "type": "join", "room": code, "name": "Back" }),
    );
    send(&mut rooms, &c, json!({ "type": "start" }));
    assert_error(&c, "Only the room admin can start");
    assert!(state(&c).game.is_none());
    send(&mut rooms, &clients[0], json!({ "type": "start" }));
    assert_eq!(game(&c).n, 3);
    assert_eq!(game(&c).hand.len(), 10);
}

#[test]
fn unknown_room_bad_theme_full_room_spectators() {
    let mut rooms = Rooms::new(fixed()).unwrap();
    let a = fake(&mut rooms, "10.0.0.1");
    send(&mut rooms, &a, json!({ "type": "join", "room": "NOPE00", "name": "x" }));
    assert!(matches!(
        last(&a),
        ServerMsg::Error {
            code: Some(ErrorCode::NoRoom),
            ..
        }
    ));
    send(
        &mut rooms,
        &a,
        json!({ "type": "create", "theme": "nope", "name": "x" }),
    );
    assert_error(&a, "theme");
    send(
        &mut rooms,
        &a,
        json!({ "type": "create", "theme": "box-office", "name": "   " }),
    );
    assert_error(&a, "name");

    let (clients, code) = seated(&mut rooms, 5);
    let sixth = fake(&mut rooms, "10.0.0.6");
    send(
        &mut rooms,
        &sixth,
        json!({ "type": "join", "room": code, "name": "Six" }),
    );
    assert_error(&sixth, "full");

    send(&mut rooms, &clients[0], json!({ "type": "start" }));
    let watcher = fake(&mut rooms, "10.0.0.7");
    send(
        &mut rooms,
        &watcher,
        json!({ "type": "join", "room": code, "name": "Late", "token": "wrong" }),
    );
    assert_eq!(joined(&watcher).1, None);
    let v = game(&watcher);
    assert_eq!(v.hand, []);
    assert!(v.players.iter().all(|p| p.money.is_none()));
    send(
        &mut rooms,
        &watcher,
        json!({ "type": "action", "action": { "type": "pass" } }),
    );
    assert_error(&watcher, "watching");
}

#[test]
fn reconnect_with_the_seat_token_restores_the_seat_tokens_are_never_broadcast() {
    let mut rooms = Rooms::new(fixed()).unwrap();
    let (clients, code) = seated(&mut rooms, 3);
    send(&mut rooms, &clients[0], json!({ "type": "start" }));
    let token = joined(&clients[1]).2.unwrap();
    let hand = game(&clients[1]).hand;

    rooms.disconnect(clients[1].id);
    assert!(!state(&clients[0]).room.seats[1].connected);
    let again = fake(&mut rooms, "10.0.0.9");
    send(
        &mut rooms,
        &again,
        json!({ "type": "join", "room": code, "token": token }),
    );
    assert_eq!(joined(&again).1, Some(1));
    assert_eq!(game(&again).hand, hand);
    assert!(state(&clients[0]).room.seats[1].connected);

    let secrets: Vec<String> = clients.iter().map(|c| joined(c).2.unwrap()).collect();
    for c in clients.iter().chain([&again]) {
        for m in c.got.lock().unwrap().iter() {
            if matches!(m, ServerMsg::State { .. }) {
                let text = serde_json::to_string(m).unwrap();
                for secret in &secrets {
                    assert!(!text.contains(secret.as_str()));
                }
            }
        }
    }
}

#[test]
fn a_tab_that_parts_stops_watching_and_its_seat_shows_away() {
    let mut rooms = Rooms::new(fixed()).unwrap();
    let (clients, code) = seated(&mut rooms, 3);
    send(&mut rooms, &clients[1], json!({ "type": "part" }));
    assert!(!state(&clients[0]).room.seats[1].connected);
    let seen = clients[1].got.lock().unwrap().len();
    send(&mut rooms, &clients[0], json!({ "type": "bot" }));
    assert_eq!(
        clients[1].got.lock().unwrap().len(),
        seen,
        "a parted tab gets no more states"
    );
    send(&mut rooms, &clients[1], json!({ "type": "start" }));
    assert_error(&clients[1], "Join a room first");
    let token = joined(&clients[1]).2.unwrap();
    send(
        &mut rooms,
        &clients[1],
        json!({ "type": "join", "room": code, "token": token }),
    );
    assert_eq!(joined(&clients[1]).1, Some(1));
    assert!(state(&clients[0]).room.seats[1].connected);
}

fn my_rooms(rooms: &mut Rooms, c: &Fake, seats: Value) -> (Vec<Value>, Vec<String>) {
    send(rooms, c, json!({ "type": "rooms", "seats": seats }));
    let msg = serde_json::to_value(last(c)).unwrap();
    assert_eq!(msg["type"], "rooms");
    (
        msg["rooms"].as_array().unwrap().clone(),
        serde_json::from_value(msg["gone"].clone()).unwrap(),
    )
}

#[test]
fn a_browser_lists_its_rooms_by_token_admin_rooms_first_a_reused_code_is_not_theirs() {
    let (now, opts) = clock(1_000_000);
    let mut rooms = Rooms::new(opts).unwrap();
    let (a, code_a) = seated(&mut rooms, 3);
    send(&mut rooms, &a[0], json!({ "type": "start" }));
    advance(&now, 1_000);
    let (b, code_b) = seated(&mut rooms, 2);
    let admin_a = joined(&a[0]).2.unwrap();
    let player_b = joined(&b[1]).2.unwrap();
    let home = fake(&mut rooms, "10.0.0.9");

    let keys = json!([
        { "room": code_b, "token": player_b },
        { "room": code_a, "token": admin_a },
        // Someone else's room under this browser's old token: the code alone grants nothing.
        { "room": code_b, "token": admin_a },
        { "room": "ZZZZZZ", "token": admin_a },
    ]);
    let (list, gone) = my_rooms(&mut rooms, &home, keys);
    assert_eq!(gone, [code_b.clone(), "ZZZZZZ".into()]);
    assert_eq!(list.len(), 2);
    assert_eq!(list[0]["code"], code_a.as_str());
    assert_eq!(list[0]["admin"], true);
    assert_eq!(list[0]["stage"], json!({ "t": "playing", "round": 0 }));
    assert_eq!(list[0]["players"], json!(["P0", "P1", "P2"]));
    assert_eq!(list[1]["code"], code_b.as_str());
    assert_eq!(
        (list[1]["admin"].clone(), list[1]["seat"].clone()),
        (json!(false), json!(1))
    );
    assert_eq!(list[1]["stage"], json!({ "t": "lobby" }));
    assert_eq!(list[1]["idleMs"], 0);
    assert_eq!(list[1]["expiresInMs"], 7 * 24 * 3600 * 1000);
    let text = serde_json::to_string(&last(&home)).unwrap();
    assert!(
        !text.contains(&admin_a) && !text.contains(&player_b),
        "tokens are never echoed"
    );

    // Expired rooms are gone for good.
    for c in a.iter().chain(&b) {
        rooms.disconnect(c.id);
    }
    advance(&now, 8 * 24 * 3600 * 1000);
    rooms.sweep();
    let (list, gone) = my_rooms(&mut rooms, &home, json!([{ "room": code_a, "token": admin_a }]));
    assert_eq!(list, Vec::<Value>::new());
    assert_eq!(gone, [code_a]);
}

#[test]
fn skip_and_release_need_30_s_of_disconnection_a_released_seat_can_be_claimed() {
    let (now, opts) = clock(1_000_000);
    let mut rooms = Rooms::new(opts).unwrap();
    let (clients, code) = seated(&mut rooms, 3);
    send(&mut rooms, &clients[0], json!({ "type": "start" }));
    let turn = game(&clients[0]).turn;
    let t = usize::from(turn);
    // Skipping and freeing are the admin's; make sure the admin is not the one who walks away.
    let a = if t == 0 {
        send(&mut rooms, &clients[0], json!({ "type": "admin", "seat": 1 }));
        1
    } else {
        0
    };
    let player = &clients[3 - t - a];
    let other = &clients[a];

    send(&mut rooms, other, json!({ "type": "skip", "seat": turn }));
    assert_error(other, "connected");
    let gone_token = joined(&clients[t]).2.unwrap();
    rooms.disconnect(clients[t].id);
    advance(&now, 29_000);
    send(&mut rooms, other, json!({ "type": "skip", "seat": turn }));
    assert_error(other, "longer");
    send(&mut rooms, other, json!({ "type": "release", "seat": turn }));
    assert_error(other, "longer");
    advance(&now, 2_000);
    send(&mut rooms, player, json!({ "type": "skip", "seat": turn }));
    assert_error(player, "Only the room admin can skip");
    send(&mut rooms, player, json!({ "type": "release", "seat": turn }));
    assert_error(player, "Only the room admin can free");
    send(&mut rooms, other, json!({ "type": "skip", "seat": turn }));
    assert_eq!(state(other).room.seats[t].away_ms, Some(31_000));
    assert_eq!(game(other).turn, (turn + 1) % 3);
    assert_eq!(game(other).players[t].hand_count, 10);

    send(&mut rooms, other, json!({ "type": "release", "seat": turn }));
    assert!(state(other).room.seats[t].open);
    let sub = fake(&mut rooms, "10.0.0.8");
    send(&mut rooms, &sub, json!({ "type": "join", "room": code }));
    assert_eq!(joined(&sub).1, None);
    send(
        &mut rooms,
        &sub,
        json!({ "type": "claim", "seat": (turn + 1) % 3, "name": "Sub" }),
    );
    assert_error(&sub, "taken");
    send(
        &mut rooms,
        &sub,
        json!({ "type": "claim", "seat": turn, "name": "Sub" }),
    );
    assert_eq!(joined(&sub).1, Some(turn));
    assert_eq!(game(&sub).hand.len(), 10);
    let seat = &state(other).room.seats[t];
    assert_eq!((seat.name.as_str(), seat.open, seat.connected), ("Sub", false, true));

    // The player who was away hears why when they come back, once.
    let admin = state(other).room.seats[a].name.clone();
    let back = fake(&mut rooms, "10.0.0.9");
    let rejoin = json!({ "type": "join", "room": code, "token": gone_token });
    send(&mut rooms, &back, rejoin.clone());
    assert_eq!(joined(&back).1, None);
    assert_eq!(
        notices(&back),
        [format!(
            "While you were away, {admin} freed your seat for someone else. You can watch."
        )]
    );
    send(&mut rooms, &back, rejoin);
    assert_eq!(notices(&back).len(), 1);
}

#[test]
fn only_whitelisted_moves_from_the_right_seat_are_applied() {
    let mut rooms = Rooms::new(fixed()).unwrap();
    let (clients, _) = seated(&mut rooms, 3);
    send(&mut rooms, &clients[0], json!({ "type": "start" }));
    let turn = usize::from(game(&clients[0]).turn);
    let wrong = &clients[(turn + 1) % 3];
    let card = game(wrong).hand[0].id;
    send(
        &mut rooms,
        wrong,
        json!({ "type": "action", "action": { "type": "play", "card": card } }),
    );
    assert_error(wrong, "not your turn");
    send(
        &mut rooms,
        wrong,
        json!({ "type": "action", "action": { "type": "skipTurn" } }),
    );
    assert_error(wrong, "Unknown move");
    send(&mut rooms, wrong, json!({ "type": "rematch" }));
    assert_error(wrong, "not over");
    send(&mut rooms, wrong, json!("garbage"));
    assert_error(wrong, "Bad message");
    send(&mut rooms, wrong, json!({ "type": "nonsense" }));
    assert_error(wrong, "Unknown message");
}

#[test]
fn admin_creator_calls_results_role_moves_by_hand_over_or_after_30_s_away() {
    let (now, opts) = clock(1_000_000);
    let mut rooms = Rooms::new(opts).unwrap();
    let (clients, _) = seated(&mut rooms, 3);
    assert_eq!(state(&clients[1]).room.admin, 0);
    send(&mut rooms, &clients[0], json!({ "type": "start" }));
    let turn = usize::from(game(&clients[0]).turn);
    let card = game(&clients[turn])
        .hand
        .into_iter()
        .find(|x| x.kind != AuctionType::Double)
        .unwrap();
    send(
        &mut rooms,
        &clients[turn],
        json!({ "type": "action", "action": { "type": "play", "card": card.id } }),
    );
    assert!(game(&clients[0]).auction.is_some());

    send(
        &mut rooms,
        &clients[1],
        json!({ "type": "rule", "winner": 1, "price": 5 }),
    );
    assert_error(&clients[1], "admin");
    send(
        &mut rooms,
        &clients[0],
        json!({ "type": "rule", "winner": 2, "price": 5 }),
    );
    let after = game(&clients[1]);
    assert!(after.auction.is_none());
    assert_eq!(
        after.players[2].bought.iter().map(|x| x.id).collect::<Vec<_>>(),
        [card.id]
    );
    assert!(matches!(after.log.last(), Some(LogEntry::Sold { by: Some(0), .. })));
    assert!(state(&clients[1]).room.can_undo);

    // Undo puts the auction back; only the admin may, and only once.
    send(&mut rooms, &clients[1], json!({ "type": "undo" }));
    assert_error(&clients[1], "admin");
    send(&mut rooms, &clients[0], json!({ "type": "undo" }));
    let undone = game(&clients[1]);
    assert_eq!(
        undone.auction.unwrap().cards.iter().map(|x| x.id).collect::<Vec<_>>(),
        [card.id]
    );
    assert_eq!(undone.players[2].bought, []);
    assert!(matches!(undone.log.last(), Some(LogEntry::Undo { by: 0, .. })));
    assert!(!state(&clients[1]).room.can_undo);
    send(&mut rooms, &clients[0], json!({ "type": "undo" }));
    assert_error(&clients[0], "Nothing to undo");

    // A move after the call closes the undo.
    send(
        &mut rooms,
        &clients[0],
        json!({ "type": "rule", "winner": 2, "price": 5 }),
    );
    let mover = &clients[usize::from(game(&clients[0]).turn)];
    let card = game(mover).hand[0].id;
    send(
        &mut rooms,
        mover,
        json!({ "type": "action", "action": { "type": "play", "card": card } }),
    );
    assert!(!state(&clients[0]).room.can_undo);
    send(&mut rooms, &clients[0], json!({ "type": "undo" }));
    assert_error(&clients[0], "Nothing to undo");

    send(&mut rooms, &clients[1], json!({ "type": "admin", "seat": 1 }));
    assert_error(&clients[1], "connected");
    send(&mut rooms, &clients[0], json!({ "type": "admin", "seat": 2 }));
    assert_eq!(state(&clients[1]).room.admin, 2);
    rooms.disconnect(clients[2].id);
    advance(&now, 31_000);
    send(&mut rooms, &clients[0], json!({ "type": "admin", "seat": 1 }));
    assert_error(&clients[0], "hand the role");
    send(&mut rooms, &clients[1], json!({ "type": "admin", "seat": 1 }));
    assert_eq!(state(&clients[0]).room.admin, 1);
    // Not to someone who is away: the room would have no admin for 30 s.
    send(&mut rooms, &clients[1], json!({ "type": "admin", "seat": 2 }));
    assert_error(&clients[1], "not connected");
    assert_eq!(state(&clients[0]).room.admin, 1);
}

#[test]
fn only_the_admin_removes_players_from_the_lobby_an_away_admin_can_be_replaced_there() {
    let (now, opts) = clock(1_000_000);
    let mut rooms = Rooms::new(opts).unwrap();
    let (clients, _) = seated(&mut rooms, 3);
    rooms.disconnect(clients[2].id);
    send(&mut rooms, &clients[1], json!({ "type": "release", "seat": 2 }));
    assert_error(&clients[1], "Only the room admin can remove a seat");
    send(&mut rooms, &clients[0], json!({ "type": "release", "seat": 2 }));
    assert_eq!(state(&clients[1]).room.seats.len(), 2);

    // The admin drops in the lobby: after 30 s someone else takes the role and can start.
    rooms.disconnect(clients[0].id);
    send(&mut rooms, &clients[1], json!({ "type": "admin", "seat": 1 }));
    assert_error(&clients[1], "longer");
    advance(&now, 31_000);
    send(&mut rooms, &clients[1], json!({ "type": "admin", "seat": 1 }));
    assert_eq!(state(&clients[1]).room.admin, 1);
    send(&mut rooms, &clients[1], json!({ "type": "bot" }));
    send(&mut rooms, &clients[1], json!({ "type": "start" }));
    assert_eq!(game(&clients[1]).n, 3);
}

#[test]
fn anyone_may_take_the_role_after_the_admin_is_away_20_s_the_first_player_gets_it_at_30_s() {
    let (now, opts) = clock(1_000_000);
    let mut rooms = Rooms::new(opts).unwrap();
    let (clients, _) = seated(&mut rooms, 3);
    assert_eq!(state(&clients[1]).room.admin_claim_ms, 20_000);
    rooms.disconnect(clients[0].id);
    advance(&now, 19_000);
    send(&mut rooms, &clients[2], json!({ "type": "admin", "seat": 2 }));
    assert_error(&clients[2], "longer");
    rooms.tick();
    assert_eq!(state(&clients[1]).room.admin, 0);
    advance(&now, 2_000);
    send(&mut rooms, &clients[2], json!({ "type": "admin", "seat": 2 }));
    assert_eq!(state(&clients[1]).room.admin, 2);

    // Nobody takes it: at 30 s the first player still here gets it, and is told.
    rooms.disconnect(clients[2].id);
    advance(&now, 29_000);
    rooms.tick();
    assert_eq!(state(&clients[1]).room.admin, 2);
    advance(&now, 1_000);
    rooms.tick();
    assert_eq!(state(&clients[1]).room.admin, 1);
    assert_eq!(notices(&clients[1]), ["P2 was away, so you are the room admin now."]);
}

#[test]
fn only_the_admin_adds_bots_starts_and_rematches_bots_play_their_seats() {
    let (now, opts) = clock(1_000_000);
    let mut rooms = Rooms::new(opts).unwrap();
    let (clients, _) = seated(&mut rooms, 2);
    let (a, b) = (&clients[0], &clients[1]);

    send(&mut rooms, b, json!({ "type": "bot" }));
    assert_error(b, "Only the room admin can add a bot");
    send(&mut rooms, a, json!({ "type": "bot" }));
    send(&mut rooms, a, json!({ "type": "bot" }));
    let seats = state(a).room.seats;
    let names: Vec<&str> = seats.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, ["P0", "P1", "Bot 1", "Bot 2"]);
    assert!(seats[2].bot && seats[2].connected && !seats[2].open);
    assert!(!seats[0].bot);

    // Removing a bot is the admin's call; its number is free again.
    send(&mut rooms, b, json!({ "type": "release", "seat": 2 }));
    assert_error(b, "Only the room admin can remove a seat");
    send(&mut rooms, a, json!({ "type": "release", "seat": 2 }));
    send(&mut rooms, a, json!({ "type": "bot" }));
    let names: Vec<String> = state(a).room.seats.iter().map(|s| s.name.clone()).collect();
    assert_eq!(names, ["P0", "P1", "Bot 2", "Bot 1"]);
    send(&mut rooms, a, json!({ "type": "admin", "seat": 2 }));
    assert_error(a, "A bot cannot be the admin");

    send(&mut rooms, b, json!({ "type": "start" }));
    assert_error(b, "Only the room admin can start");
    send(&mut rooms, a, json!({ "type": "start" }));
    assert_eq!(game(a).n, 4);
    send(&mut rooms, a, json!({ "type": "bot" }));
    assert_error(a, "seats are locked");

    // The players move at random; the server moves the bots once their thinking time is up.
    let mut rng = rand::rng();
    for _ in 0..5_000 {
        let v = game(a);
        if v.over {
            break;
        }
        for c in [a, b] {
            if let Some(action) = server::bot::choose_action(&game(c), &mut rng) {
                send(&mut rooms, c, json!({ "type": "action", "action": action }));
            }
        }
        rooms.tick();
        advance(&now, 2_500);
        rooms.tick();
    }
    let v = game(a);
    assert!(v.over, "the game should finish");
    let bot_moved = |seat: u8| {
        v.log.iter().any(|e| {
            matches!(e, LogEntry::Play { p, .. } | LogEntry::Bid { p, .. } | LogEntry::Pass { p }
                | LogEntry::Price { p, .. } | LogEntry::Decline { p } if *p == seat)
        })
    };
    assert!(bot_moved(2) && bot_moved(3), "both bots should have moved");
    assert!(!v.log.iter().any(|e| matches!(e, LogEntry::Skip { .. })));

    send(&mut rooms, b, json!({ "type": "rematch" }));
    assert_error(b, "Only the room admin can start a rematch");
    let cast = state(a).room.cast;
    send(&mut rooms, a, json!({ "type": "rematch" }));
    assert!(!game(a).over);
    // Same genres, new names.
    let after = state(a).room.cast;
    assert_eq!(after.genres, cast.genres);
    assert_ne!(after.seed, cast.seed);
}

#[test]
fn the_admin_picks_the_cast_in_the_lobby() {
    let (_, opts) = clock(1_000_000);
    let mut rooms = Rooms::new(opts).unwrap();
    let (clients, _) = seated(&mut rooms, 3);
    let (a, b) = (&clients[0], &clients[1]);
    let first = state(a).room.cast;
    assert_eq!(first.genres, [0u8; 0]);

    send(&mut rooms, b, json!({ "type": "cast", "genres": [] }));
    assert_error(b, "Only the room admin can pick the cast");
    for bad in [json!([0, 1, 2, 3]), json!([0, 1, 2, 3, 3]), json!([0, 1, 2, 3, 64])] {
        send(&mut rooms, a, json!({ "type": "cast", "genres": bad }));
        assert_error(a, "Pick 5 different genres");
    }
    send(&mut rooms, a, json!({ "type": "cast", "genres": [5, 0, 2, 3, 1] }));
    let cast = state(a).room.cast;
    assert_eq!(cast.genres, [0, 1, 2, 3, 5]);
    assert_eq!(cast.seed, first.seed, "a pick keeps the names");
    send(&mut rooms, a, json!({ "type": "cast", "genres": [], "reroll": true }));
    let cast = state(b).room.cast;
    assert_eq!(cast.genres, [0u8; 0]);
    assert_ne!(cast.seed, first.seed);

    send(&mut rooms, a, json!({ "type": "start" }));
    send(&mut rooms, a, json!({ "type": "cast", "genres": [], "reroll": true }));
    assert_error(a, "the cast is set");
}

#[test]
fn a_creator_brings_their_saved_settings_and_bad_ones_fall_back_to_the_defaults() {
    let (_, opts) = clock(1_000_000);
    let mut rooms = Rooms::new(opts).unwrap();
    let a = fake(&mut rooms, "10.0.0.1");
    send(
        &mut rooms,
        &a,
        json!({ "type": "create", "theme": "box-office", "name": "a",
                "prefs": { "bidTimerS": 0, "bidExtendS": 20, "genres": [4, 0, 2, 3, 1] } }),
    );
    let room = state(&a).room;
    assert_eq!((room.bid_timer_s, room.bid_extend_s), (0, 20));
    assert_eq!(room.cast.genres, [0, 1, 2, 3, 4]);

    let b = fake(&mut rooms, "10.0.0.2");
    send(
        &mut rooms,
        &b,
        json!({ "type": "create", "theme": "box-office", "name": "b",
                "prefs": { "bidTimerS": 9999, "bidExtendS": 1, "genres": [1, 1] } }),
    );
    let room = state(&b).room;
    assert_eq!((room.bid_timer_s, room.bid_extend_s), (30, 10));
    assert_eq!(room.cast.genres, [0u8; 0]);
    assert!(!room.settings.locked);

    let c = fake(&mut rooms, "10.0.0.3");
    send(
        &mut rooms,
        &c,
        json!({ "type": "create", "theme": "box-office", "name": "c",
                "prefs": { "bidTimerS": 30, "bidExtendS": 10, "settings": { "locked": true, "later": 1 } } }),
    );
    assert!(state(&c).room.settings.locked);
}

#[test]
fn only_the_admin_changes_settings_a_locked_room_takes_no_new_seats_but_watchers() {
    let (_, opts) = clock(1_000_000);
    let mut rooms = Rooms::new(opts).unwrap();
    let (clients, code) = seated(&mut rooms, 2);
    let lock = json!({ "type": "settings", "settings": { "locked": true } });
    send(&mut rooms, &clients[1], lock.clone());
    assert_error(&clients[1], "Only the room admin can change the room settings");
    send(&mut rooms, &clients[0], lock);
    assert!(state(&clients[1]).room.settings.locked);

    let late = fake(&mut rooms, "10.0.0.9");
    send(&mut rooms, &late, json!({ "type": "join", "room": code }));
    assert_eq!(joined(&late).1, None);
    send(
        &mut rooms,
        &late,
        json!({ "type": "join", "room": code, "name": "Late" }),
    );
    assert_error(&late, "The admin locked this room");
    assert_eq!(state(&clients[0]).room.seats.len(), 2);
    // The admin can still fill seats with bots.
    send(&mut rooms, &clients[0], json!({ "type": "bot" }));
    assert_eq!(state(&clients[0]).room.seats.len(), 3);

    send(
        &mut rooms,
        &clients[0],
        json!({ "type": "settings", "settings": { "locked": false } }),
    );
    send(
        &mut rooms,
        &late,
        json!({ "type": "join", "room": code, "name": "Late" }),
    );
    assert_eq!(joined(&late).1, Some(3));
}

#[test]
fn players_rename_themselves_only_while_the_admin_allows_it() {
    let mut rooms = Rooms::new(fixed()).unwrap();
    let (clients, _) = seated(&mut rooms, 3);
    let rename = json!({ "type": "rename", "name": "  Neo\u{1} " });
    send(&mut rooms, &clients[1], rename.clone());
    assert_error(&clients[1], "The admin has not turned on renaming");
    send(
        &mut rooms,
        &clients[0],
        json!({ "type": "settings", "settings": { "rename": true } }),
    );
    send(&mut rooms, &clients[1], rename.clone());
    assert_eq!(state(&clients[0]).room.seats[1].name, "Neo");
    send(&mut rooms, &clients[1], json!({ "type": "rename", "name": "  " }));
    assert_error(&clients[1], "Enter a name");

    // In a game too.
    send(&mut rooms, &clients[0], json!({ "type": "start" }));
    send(&mut rooms, &clients[2], json!({ "type": "rename", "name": "Trinity" }));
    let seats = state(&clients[0]).room.seats;
    assert!(seats.iter().any(|s| s.name == "Trinity"));
    let watcher = fake(&mut rooms, "10.0.0.9");
    send(
        &mut rooms,
        &watcher,
        json!({ "type": "join", "room": joined(&clients[0]).0 }),
    );
    send(&mut rooms, &watcher, rename);
    assert_error(&watcher, "take a seat first");
}

#[test]
fn players_say_they_are_ready_and_the_admin_may_start_anyway() {
    let mut rooms = Rooms::new(fixed()).unwrap();
    let (clients, _) = seated(&mut rooms, 3);
    send(&mut rooms, &clients[0], json!({ "type": "bot" }));
    let ready = |c: &Fake| state(c).room.seats.iter().map(|s| s.ready).collect::<Vec<_>>();
    assert_eq!(ready(&clients[0]), [false, false, false, true], "bots are always ready");
    send(&mut rooms, &clients[1], json!({ "type": "ready", "on": true }));
    assert_eq!(ready(&clients[2]), [false, true, false, true]);
    send(&mut rooms, &clients[1], json!({ "type": "ready", "on": false }));
    send(&mut rooms, &clients[2], json!({ "type": "ready", "on": true }));
    assert_eq!(ready(&clients[0]), [false, false, true, true]);

    // P1 is not ready; the admin starts anyway. Back in the lobby everyone starts unready.
    send(&mut rooms, &clients[0], json!({ "type": "start" }));
    assert!(state(&clients[0]).game.is_some());
    send(&mut rooms, &clients[2], json!({ "type": "ready", "on": false }));
    assert_error(&clients[2], "The game has already started");
    send(&mut rooms, &clients[0], json!({ "type": "end" }));
    send(&mut rooms, &clients[0], json!({ "type": "lobby" }));
    assert_eq!(ready(&clients[0]), [false, false, false, true]);
}

/// Every `reaction` this client got, oldest first.
fn reactions(c: &Fake) -> Vec<(u8, String)> {
    let got = c.got.lock().unwrap();
    got.iter()
        .filter_map(|m| match m {
            ServerMsg::Reaction { seat, emoji } => Some((*seat, emoji.clone())),
            _ => None,
        })
        .collect()
}

#[test]
fn reactions_from_the_admins_set_reach_everyone_a_few_at_a_time() {
    let (now, opts) = clock(1_000_000);
    let mut rooms = Rooms::new(opts).unwrap();
    let (clients, code) = seated(&mut rooms, 3);
    let watcher = fake(&mut rooms, "10.0.0.9");
    send(&mut rooms, &watcher, json!({ "type": "join", "room": code }));
    assert_eq!(state(&clients[0]).room.settings.reactions.len(), 6, "a default set");

    let react = |e: &str| json!({ "type": "react", "emoji": e });
    send(&mut rooms, &clients[1], react("👏"));
    assert_eq!(reactions(&watcher), [(1, "👏".to_owned())]);
    assert_eq!(reactions(&clients[2]), [(1, "👏".to_owned())]);
    send(&mut rooms, &clients[1], react("🦄"));
    assert_error(&clients[1], "That reaction is not on in this room");
    send(&mut rooms, &watcher, react("👏"));
    assert_error(&watcher, "take a seat first");
    for _ in 0..3 {
        send(&mut rooms, &clients[1], react("🔥"));
    }
    send(&mut rooms, &clients[1], react("🔥"));
    assert_error(&clients[1], "Easy on the reactions");
    advance(&now, 4_000);
    send(&mut rooms, &clients[1], react("🔥"));
    assert_eq!(reactions(&watcher).len(), 5);

    // The admin picks the set, also mid-game; an empty set turns reactions off.
    send(&mut rooms, &clients[0], json!({ "type": "start" }));
    let set = |r: Value| json!({ "type": "settings", "settings": { "reactions": r } });
    send(&mut rooms, &clients[0], set(json!(["🦄", "🦄"])));
    assert_error(&clients[0], "Pick up to 8 different reactions");
    send(
        &mut rooms,
        &clients[0],
        set(json!(["a", "b", "c", "d", "e", "f", "g", "h", "i"])),
    );
    assert_error(&clients[0], "Pick up to 8 different reactions");
    send(&mut rooms, &clients[0], set(json!(["🦄"])));
    send(&mut rooms, &clients[2], react("🦄"));
    assert_eq!(reactions(&watcher).last(), Some(&(2, "🦄".to_owned())));
    send(&mut rooms, &clients[0], set(json!([])));
    send(&mut rooms, &clients[2], react("🦄"));
    assert_error(&clients[2], "That reaction is not on in this room");
}

/// Every client still sits under the name it joined with, and the admin role stayed with P0.
fn names_follow_seats(clients: &[Fake]) {
    for (i, c) in clients.iter().enumerate() {
        let s = state(c);
        let seat = usize::from(s.you.unwrap());
        assert_eq!(s.room.seats[seat].name, format!("P{i}"));
        assert_eq!(s.game.unwrap().you, s.you);
    }
    let s = state(&clients[0]);
    assert_eq!(s.room.admin, s.you.unwrap());
}

#[test]
fn seats_are_drawn_when_a_game_starts_and_each_round_if_the_admin_wants() {
    let mut rooms = Rooms::new(Options::default()).unwrap();
    let (clients, _) = seated(&mut rooms, 5);
    send(
        &mut rooms,
        &clients[0],
        json!({ "type": "settings", "settings": { "shuffleEachRound": true } }),
    );
    // Some start out of join order (5 seats drawn twice in a row as joined: 1 in 14 400).
    let mut drawn = false;
    for _ in 0..2 {
        send(&mut rooms, &clients[0], json!({ "type": "start" }));
        names_follow_seats(&clients);
        assert!(
            notices(&clients[3])
                .last()
                .unwrap()
                .starts_with("Seats drawn at random. Clockwise: ")
        );
        drawn |= clients
            .iter()
            .enumerate()
            .any(|(i, c)| state(c).you != u8::try_from(i).ok());
        send(&mut rooms, &clients[0], json!({ "type": "end" }));
        send(&mut rooms, &clients[0], json!({ "type": "lobby" }));
    }
    assert!(drawn);

    send(&mut rooms, &clients[0], json!({ "type": "start" }));
    let mut rng = rand::rng();
    while game(&clients[0]).round == 0 {
        for c in &clients {
            if let Some(action) = server::bot::choose_action(&game(c), &mut rng) {
                send(&mut rooms, c, json!({ "type": "action", "action": action }));
            }
        }
    }
    assert!(
        notices(&clients[1])
            .last()
            .unwrap()
            .starts_with("New seats for this round. Clockwise: ")
    );
    names_follow_seats(&clients);
    // The hands moved with their players: everyone holds what the game says they hold.
    for c in &clients {
        let g = game(c);
        assert_eq!(
            g.hand.len(),
            usize::from(g.players[usize::from(g.you.unwrap())].hand_count)
        );
    }
}

#[test]
fn an_open_auction_closes_when_its_bid_timer_runs_out_and_a_late_bid_adds_time() {
    let (now, opts) = clock(1_000_000);
    let mut rooms = Rooms::new(opts).unwrap();
    let (clients, _) = seated(&mut rooms, 3);
    let admin = &clients[0];
    assert_eq!(
        (state(admin).room.bid_timer_s, state(admin).room.bid_extend_s),
        (30, 10)
    );
    send(
        &mut rooms,
        &clients[1],
        json!({ "type": "timer", "seconds": 5, "extend": 3 }),
    );
    assert_error(&clients[1], "Only the room admin can set the bid timer");
    send(
        &mut rooms,
        admin,
        json!({ "type": "timer", "seconds": 601, "extend": 3 }),
    );
    assert_error(admin, "at most 600 seconds");
    send(&mut rooms, admin, json!({ "type": "timer", "seconds": 5, "extend": 2 }));
    assert_error(admin, "Time after a bid is 3 to 120 seconds");
    send(&mut rooms, admin, json!({ "type": "timer", "seconds": 8, "extend": 3 }));
    assert_eq!((state(admin).room.bid_timer_s, state(admin).room.bid_extend_s), (8, 3));
    send(&mut rooms, admin, json!({ "type": "start" }));

    // The clock does not move while the players reach it.
    play_to_open_auction(&mut rooms, &clients);
    assert_eq!(state(admin).room.bid_ms_left, Some(8_000));
    assert_eq!(state(admin).room.bid_ms_window, Some(8_000));

    advance(&now, 6_000);
    rooms.tick();
    assert!(is_open(admin));
    let bidder = clients
        .iter()
        .find(|c| game(c).players[usize::from(game(c).you.unwrap())].money >= Some(1))
        .unwrap();
    let seat = game(bidder).you.unwrap();
    let high = game(bidder).auction.unwrap().high;
    send(
        &mut rooms,
        bidder,
        json!({ "type": "action", "action": { "type": "bid", "amount": high + 1, "seenHigh": high } }),
    );
    let room = state(admin).room;
    assert_eq!(room.bid_ms_left, Some(3_000), "a late bid tops the clock up");
    assert_eq!(room.bid_ms_window, Some(3_000));

    advance(&now, 2_500);
    rooms.tick();
    assert!(is_open(admin));
    advance(&now, 1_000);
    rooms.tick();
    let v = game(admin);
    assert!(v.auction.is_none_or(|a| a.kind != AuctionKind::Open), "time is up");
    assert_eq!(state(admin).room.bid_ms_left, None);
    let sold = v.log.iter().rev().find(|e| matches!(e, LogEntry::Sold { .. }));
    assert!(matches!(sold, Some(LogEntry::Sold { to, price, .. }) if *to == seat && *price == high + 1));
}

fn is_open(c: &Fake) -> bool {
    game(c).auction.is_some_and(|a| a.kind == AuctionKind::Open)
}

/// Plays random moves for every client until an open auction is up.
fn play_to_open_auction(rooms: &mut Rooms, clients: &[Fake]) {
    let mut rng = rand::rng();
    for _ in 0..2_000 {
        assert!(!game(&clients[0]).over, "no open auction came up");
        for c in clients {
            if is_open(c) {
                return;
            }
            if let Some(action) = server::bot::choose_action(&game(c), &mut rng) {
                send(rooms, c, json!({ "type": "action", "action": action }));
            }
        }
    }
    panic!("no open auction came up");
}

#[test]
fn a_frozen_game_stops_the_clock_and_every_move_until_whoever_froze_it_or_the_admin_unfreezes() {
    let (now, opts) = clock(1_000_000);
    let mut rooms = Rooms::new(opts).unwrap();
    let (clients, _) = seated(&mut rooms, 3);
    let admin = &clients[0];
    send(&mut rooms, admin, json!({ "type": "freeze", "on": true }));
    assert_error(admin, "The game has not started");
    send(&mut rooms, admin, json!({ "type": "timer", "seconds": 8, "extend": 3 }));
    send(&mut rooms, admin, json!({ "type": "start" }));
    play_to_open_auction(&mut rooms, &clients);

    send(&mut rooms, &clients[1], json!({ "type": "freeze", "on": true }));
    assert_error(&clients[1], "Only the room admin can freeze the game");
    send(
        &mut rooms,
        admin,
        json!({ "type": "settings", "settings": { "freeze": "anyone" } }),
    );
    send(&mut rooms, &clients[1], json!({ "type": "freeze", "on": true }));
    assert_eq!(state(admin).room.frozen_by, Some(1));
    send(&mut rooms, admin, json!({ "type": "freeze", "on": true }));
    assert_error(admin, "already froze the game");

    // Time passes, the clock stands still, nobody moves.
    advance(&now, 20_000);
    rooms.tick();
    assert!(is_open(admin));
    assert_eq!(state(admin).room.bid_ms_left, Some(8_000));
    for c in &clients {
        if let Some(action) = server::bot::choose_action(&game(c), &mut rand::rng()) {
            send(&mut rooms, c, json!({ "type": "action", "action": action }));
            assert_error(c, "froze the game; wait until it runs again");
        }
    }
    send(&mut rooms, admin, json!({ "type": "rule", "winner": null, "price": 0 }));
    assert_error(admin, "P1 froze the game");
    send(&mut rooms, &clients[2], json!({ "type": "freeze", "on": false }));
    assert_error(&clients[2], "Only P1 or the room admin can unfreeze");

    // The admin unfreezes anyone's freeze; the clock goes on from where it stood.
    send(&mut rooms, admin, json!({ "type": "freeze", "on": false }));
    assert_eq!(state(admin).room.frozen_by, None);
    assert_eq!(state(admin).room.bid_ms_left, Some(8_000));
    advance(&now, 5_000);
    rooms.tick();
    send(&mut rooms, &clients[2], json!({ "type": "freeze", "on": true }));
    assert_eq!(state(admin).room.bid_ms_left, Some(3_000));
    advance(&now, 60_000);
    rooms.tick();
    send(&mut rooms, &clients[2], json!({ "type": "freeze", "on": false }));
    assert_eq!(state(admin).room.bid_ms_left, Some(3_000));
    advance(&now, 3_000);
    rooms.tick();
    assert!(!is_open(admin), "time is up");
    send(&mut rooms, admin, json!({ "type": "freeze", "on": false }));
    assert_error(admin, "The game is not frozen");
}

#[test]
fn bots_never_hold_admin_and_leave_with_the_last_player() {
    let mut rooms = Rooms::new(fixed()).unwrap();
    let (clients, code) = seated(&mut rooms, 1);
    let a = &clients[0];
    send(&mut rooms, a, json!({ "type": "bot" }));
    let b = fake(&mut rooms, "10.0.0.2");
    send(&mut rooms, &b, json!({ "type": "join", "room": code, "name": "B" }));
    send(&mut rooms, a, json!({ "type": "leave" }));
    // Seat 0 is now the bot; the role goes to the player behind it.
    assert_eq!(state(&b).room.admin, 1);
    send(&mut rooms, &b, json!({ "type": "leave" }));
    assert!(state(a).room.seats.is_empty());
}

#[test]
fn a_bot_stands_in_for_a_disconnected_player_until_they_rejoin_kicked_players_lose_the_seat() {
    let (now, opts) = clock(1_000_000);
    let mut rooms = Rooms::new(opts).unwrap();
    let (clients, code) = seated(&mut rooms, 3);
    let (a, b, c) = (&clients[0], &clients[1], &clients[2]);
    send(&mut rooms, a, json!({ "type": "start" }));

    send(&mut rooms, a, json!({ "type": "bot", "seat": 1 }));
    assert_error(a, "connected");
    let token = joined(b).2.unwrap();
    rooms.disconnect(b.id);
    send(&mut rooms, c, json!({ "type": "bot", "seat": 1 }));
    assert_error(c, "Only the room admin can add a bot");
    send(&mut rooms, a, json!({ "type": "bot", "seat": 1 }));
    let seat = state(a).room.seats[1].clone();
    assert!(seat.bot && !seat.connected && !seat.open);
    advance(&now, 31_000);
    send(&mut rooms, a, json!({ "type": "skip", "seat": 1 }));
    assert_error(a, "A bot is playing that seat");

    // The bot moves for seat 1 while the others play.
    let moved_by = |v: &View, seat: u8, from: usize| {
        v.log.iter().skip(from.saturating_sub(v.log_start as usize)).any(|e| {
            matches!(e, LogEntry::Play { p, .. } | LogEntry::Bid { p, .. } | LogEntry::Pass { p }
                | LogEntry::Price { p, .. } | LogEntry::Decline { p } if *p == seat)
        })
    };
    let v = game(a);
    let from = v.log_start as usize + v.log.len();
    let mut rng = rand::rng();
    for _ in 0..500 {
        if moved_by(&game(a), 1, from) {
            break;
        }
        for c in [a, c] {
            if let Some(action) = server::bot::choose_action(&game(c), &mut rng) {
                send(&mut rooms, c, json!({ "type": "action", "action": action }));
            }
        }
        advance(&now, 2_500);
        rooms.tick();
        rooms.tick();
    }
    assert!(moved_by(&game(a), 1, from), "the bot should play seat 1");

    // The player comes back and has the seat again.
    let back = fake(&mut rooms, "10.0.0.2");
    send(
        &mut rooms,
        &back,
        json!({ "type": "join", "room": code, "token": token }),
    );
    assert_eq!(joined(&back).1, Some(1));
    assert!(!state(a).room.seats[1].bot && state(a).room.seats[1].connected);
    assert_eq!(
        notices(&back),
        ["A bot played your seat while you were away. It is yours again."]
    );

    // Kicking: admin only, not yourself; the player becomes a watcher and a bot plays on.
    send(&mut rooms, &back, json!({ "type": "kick", "seat": 2 }));
    assert_error(&back, "Only the room admin can kick");
    send(&mut rooms, a, json!({ "type": "kick", "seat": 0 }));
    assert_error(a, "kick yourself");
    let c_token = joined(c).2.unwrap();
    send(&mut rooms, a, json!({ "type": "kick", "seat": 2 }));
    assert_eq!(joined(c).1, None);
    assert_eq!(state(c).you, None);
    assert_eq!(notices(c), ["P0 gave your seat to a bot. You can still watch."]);
    let seat = state(a).room.seats[2].clone();
    assert!(seat.bot && seat.connected && !seat.open);
    let again = fake(&mut rooms, "10.0.0.3");
    send(
        &mut rooms,
        &again,
        json!({ "type": "join", "room": code, "token": c_token }),
    );
    assert_eq!(joined(&again).1, None);
}

#[test]
fn a_player_leaves_mid_game_to_a_bot_and_takes_the_seat_back_only_when_asked() {
    let mut rooms = Rooms::new(fixed()).unwrap();
    let (clients, code) = seated(&mut rooms, 3);
    let (a, b, c) = (&clients[0], &clients[1], &clients[2]);
    send(&mut rooms, a, json!({ "type": "start" }));
    let token = joined(b).2.unwrap();

    send(&mut rooms, b, json!({ "type": "back" }));
    assert_error(b, "You already have a seat");
    send(&mut rooms, b, json!({ "type": "leave" }));
    assert_eq!(state(b).you, None);
    assert_eq!(state(b).left, Some(1));
    assert_eq!(state(c).left, None);
    let seat = state(a).room.seats[1].clone();
    assert!(seat.bot && !seat.connected && !seat.open);

    // A reconnect with the token watches; only `back` seats them again.
    rooms.disconnect(b.id);
    let b = fake(&mut rooms, "10.0.0.2");
    send(&mut rooms, &b, json!({ "type": "join", "room": code, "token": token }));
    assert_eq!(joined(&b).1, None);
    assert_eq!(state(&b).left, Some(1));
    let w = fake(&mut rooms, "10.0.0.9");
    send(&mut rooms, &w, json!({ "type": "join", "room": code }));
    send(&mut rooms, &w, json!({ "type": "back" }));
    assert_error(&w, "no longer yours");
    send(&mut rooms, &b, json!({ "type": "back" }));
    assert_eq!(joined(&b), (code.clone(), Some(1), Some(token)));
    assert_eq!(state(&b).left, None);
    assert!(!state(a).room.seats[1].bot && state(a).room.seats[1].connected);

    // The admin leaving hands the role to the first player still here.
    send(&mut rooms, a, json!({ "type": "leave" }));
    assert_eq!(state(&b).room.admin, 1);
}

#[test]
fn the_admin_frees_a_bot_seat_the_bot_plays_until_someone_claims_it() {
    let mut rooms = Rooms::new(fixed()).unwrap();
    let (clients, code) = seated(&mut rooms, 3);
    let (a, b, c) = (&clients[0], &clients[1], &clients[2]);
    send(&mut rooms, a, json!({ "type": "bot" }));
    send(&mut rooms, a, json!({ "type": "start" }));
    let w = fake(&mut rooms, "10.0.0.9");
    send(&mut rooms, &w, json!({ "type": "join", "room": code }));

    send(&mut rooms, b, json!({ "type": "release", "seat": 3 }));
    assert_error(b, "Only the room admin can free a seat");
    send(&mut rooms, a, json!({ "type": "release", "seat": 3 }));
    let seat = state(a).room.seats[3].clone();
    assert!(seat.bot && seat.open);
    send(&mut rooms, a, json!({ "type": "release", "seat": 3 }));
    assert_error(a, "already free");
    // `bot` withdraws the offer, `release` makes it again.
    send(&mut rooms, a, json!({ "type": "bot", "seat": 3 }));
    assert!(!state(a).room.seats[3].open);
    send(&mut rooms, a, json!({ "type": "release", "seat": 3 }));

    send(&mut rooms, &w, json!({ "type": "claim", "seat": 3, "name": "Wanda" }));
    assert_eq!(joined(&w).1, Some(3));
    let seat = state(a).room.seats[3].clone();
    assert!(!seat.bot && !seat.open && seat.name == "Wanda");

    // A seat its player left: they watch, hear that it went, and cannot take it back.
    send(&mut rooms, c, json!({ "type": "leave" }));
    send(&mut rooms, a, json!({ "type": "release", "seat": 2 }));
    assert_eq!(
        notices(c),
        ["P0 freed your seat for someone else; a bot plays it until they take it. You can watch."]
    );
    assert_eq!(state(c).left, None);
    assert!(state(a).room.seats[2].open);
}

#[test]
fn the_admin_ends_early_shows_the_score_then_goes_back_to_the_lobby_with_the_same_seats() {
    let (now, opts) = clock(1_000_000);
    let mut rooms = Rooms::new(opts).unwrap();
    let (clients, _) = seated(&mut rooms, 5);
    let (a, b) = (&clients[0], &clients[1]);
    send(&mut rooms, a, json!({ "type": "lobby" }));
    assert_error(a, "End the game first");
    send(&mut rooms, a, json!({ "type": "start" }));
    send(&mut rooms, a, json!({ "type": "lobby" }));
    assert_error(a, "End the game first");
    send(&mut rooms, b, json!({ "type": "end" }));
    assert_error(b, "Only the room admin can end the game");

    // Seat 2 kicked (a bot plays on), seat 3 away with a stand-in bot, seat 4 away and freed.
    send(&mut rooms, a, json!({ "type": "kick", "seat": 2 }));
    rooms.disconnect(clients[3].id);
    send(&mut rooms, a, json!({ "type": "bot", "seat": 3 }));
    rooms.disconnect(clients[4].id);
    advance(&now, 31_000);
    send(&mut rooms, a, json!({ "type": "release", "seat": 4 }));

    send(&mut rooms, a, json!({ "type": "end" }));
    let g = game(b);
    assert!(g.over);
    assert!(g.players.iter().all(|p| p.money.is_some()), "everyone sees the score");
    assert!(matches!(g.log.last(), Some(LogEntry::End { by: Some(0), .. })));
    send(&mut rooms, b, json!({ "type": "lobby" }));
    assert_error(b, "Only the room admin can change the setup");

    send(&mut rooms, a, json!({ "type": "lobby" }));
    let s = state(b);
    assert!(s.game.is_none() && !s.room.started);
    let seats: Vec<_> = s
        .room
        .seats
        .iter()
        .map(|x| (x.name.as_str(), x.bot, x.connected))
        .collect();
    assert_eq!(
        seats,
        [
            ("P0", false, true),
            ("P1", false, true),
            ("P2", true, true),
            ("P3", false, false)
        ],
        "the kicked seat stays a bot, the stand-in hands back, the freed seat goes"
    );
    assert_eq!(s.you, Some(1));

    send(&mut rooms, b, json!({ "type": "theme", "theme": "leather-willow" }));
    assert_error(b, "Only the room admin can change the theme");
    send(&mut rooms, a, json!({ "type": "cast", "genres": [0, 1, 2, 3, 4] }));
    send(&mut rooms, a, json!({ "type": "theme", "theme": "leather-willow" }));
    let room = state(b).room;
    assert_eq!(room.theme, "leather-willow");
    assert!(
        room.cast.genres.is_empty(),
        "genre numbers mean other genres in another theme"
    );
    send(&mut rooms, a, json!({ "type": "theme", "theme": "nope" }));
    assert_error(a, "Bad message");

    send(&mut rooms, a, json!({ "type": "start" }));
    assert_eq!(game(b).players.len(), 4);
    send(&mut rooms, a, json!({ "type": "theme", "theme": "box-office" }));
    assert_error(a, "Change the theme in the lobby");
}

#[test]
fn the_admin_closes_the_room_and_everyone_in_it_is_told() {
    let dir = TmpDir::new("close");
    let (_, opts) = clock(1_000_000);
    let mut rooms = rooms_in(&dir.0, opts);
    let (clients, code) = seated(&mut rooms, 3);
    let watcher = fake(&mut rooms, "10.0.0.8");
    send(&mut rooms, &watcher, json!({ "type": "join", "room": code }));
    send(&mut rooms, &clients[1], json!({ "type": "close" }));
    assert_error(&clients[1], "Only the room admin can close the room");
    send(&mut rooms, &clients[0], json!({ "type": "close" }));
    for c in clients.iter().chain([&watcher]) {
        let msg = serde_json::to_value(last(c)).unwrap();
        assert_eq!(msg, json!({ "type": "closed", "room": code, "by": "P0" }));
    }
    assert_eq!(rooms.len(), 0);
    rooms.flush();
    assert_eq!(dir.files(), Vec::<String>::new());
    send(&mut rooms, &clients[1], json!({ "type": "start" }));
    assert_error(&clients[1], "Join a room first");
    send(&mut rooms, &watcher, json!({ "type": "join", "room": code }));
    assert_error(&watcher, "does not exist");
}

#[test]
fn the_admin_kicks_from_the_lobby() {
    let mut rooms = Rooms::new(fixed()).unwrap();
    let (clients, _) = seated(&mut rooms, 3);
    send(&mut rooms, &clients[0], json!({ "type": "kick", "seat": 1 }));
    assert_eq!(state(&clients[1]).you, None);
    assert_eq!(
        notices(&clients[1]),
        ["P0 removed you from the lobby. You can still watch."]
    );
    assert_eq!(state(&clients[2]).you, Some(1));
    assert_eq!(notices(&clients[2]), Vec::<String>::new());
    let names: Vec<String> = state(&clients[0]).room.seats.iter().map(|s| s.name.clone()).collect();
    assert_eq!(names, ["P0", "P2"]);
}

#[test]
fn a_kick_sticks_until_the_admin_lets_them_back_in_watchers_are_listed_and_can_be_removed() {
    let mut rooms = Rooms::new(fixed()).unwrap();
    let (clients, code) = seated(&mut rooms, 3);
    let (admin, kicked) = (&clients[0], &clients[1]);
    let token = joined(kicked).2.unwrap();
    send(&mut rooms, admin, json!({ "type": "kick", "seat": 1 }));
    let watchers = state(admin).room.watchers;
    assert_eq!(watchers.len(), 1);
    assert_eq!(
        (watchers[0].id, watchers[0].name.as_str(), watchers[0].ban),
        (Some(kicked.id), "P1", Some(0))
    );

    // Still watching, but no seat; the browser keeps the token and Home does not call it gone.
    let take_seat = json!({ "type": "join", "room": code, "token": token, "name": "P1" });
    send(&mut rooms, kicked, take_seat.clone());
    assert_error(kicked, "The admin took you off the seats here");
    assert_eq!(state(kicked).you, None);
    let home = fake(&mut rooms, "10.0.0.7");
    let (list, gone) = my_rooms(&mut rooms, &home, json!([{ "room": code, "token": token }]));
    assert_eq!((list.len(), gone.len()), (0, 0));

    // Gone from the room, the ban is still listed (offline); only the admin lifts it.
    rooms.disconnect(kicked.id);
    let watchers = state(admin).room.watchers;
    assert_eq!((watchers[0].id, watchers[0].ban), (None, Some(0)));
    send(&mut rooms, &clients[2], json!({ "type": "unban", "ban": 0 }));
    assert_error(&clients[2], "Only the room admin can let someone back in");
    send(&mut rooms, admin, json!({ "type": "unban", "ban": 0 }));
    assert_eq!(state(admin).room.watchers, []);
    let back = fake(&mut rooms, "10.0.0.2");
    send(&mut rooms, &back, take_seat);
    assert_eq!(joined(&back).1, Some(2));

    // A watcher shows by their saved name; removed, they are sent out and cannot come back.
    let w = fake(&mut rooms, "10.0.0.9");
    let watch = json!({ "type": "join", "room": code, "viewer": "Wanda" });
    send(&mut rooms, &w, watch);
    let watchers = state(admin).room.watchers;
    assert_eq!(
        (watchers[0].id, watchers[0].name.as_str(), watchers[0].ban),
        (Some(w.id), "Wanda", None)
    );
    send(&mut rooms, &back, json!({ "type": "remove", "watcher": w.id }));
    assert_error(&back, "Only the room admin can remove a watcher");
    send(&mut rooms, admin, json!({ "type": "remove", "watcher": admin.id }));
    assert_error(admin, "not watching");
    send(&mut rooms, admin, json!({ "type": "remove", "watcher": w.id }));
    let ServerMsg::Removed { room, token, message } = last(&w) else {
        panic!("expected removed, got {:?}", last(&w));
    };
    assert_eq!(
        (room.as_str(), message),
        (code.as_str(), format!("P0 removed you from room {code}."))
    );
    let watchers = state(admin).room.watchers;
    assert_eq!(
        (watchers[0].id, watchers[0].name.as_str(), watchers[0].ban),
        (None, "Wanda", Some(0))
    );
    let again = json!({ "type": "join", "room": code, "token": token, "viewer": "Wanda" });
    send(&mut rooms, &w, again.clone());
    assert!(matches!(last(&w), ServerMsg::Removed { .. }));
    send(&mut rooms, admin, json!({ "type": "unban", "ban": 0 }));
    send(&mut rooms, &w, again);
    assert_eq!(joined(&w), (code.clone(), None, None));
    assert_eq!(state(admin).room.watchers.len(), 1);
}

#[test]
fn players_bring_and_change_their_look_bots_get_one() {
    let mut rooms = Rooms::new(fixed()).unwrap();
    let a = fake(&mut rooms, "10.0.0.1");
    send(
        &mut rooms,
        &a,
        json!({ "type": "create", "theme": "box-office", "name": "A", "avatar": "Ab-3<z>" }),
    );
    let code = joined(&a).0;
    let b = fake(&mut rooms, "10.0.0.2");
    send(&mut rooms, &b, json!({ "type": "join", "room": code, "name": "B" }));
    send(&mut rooms, &a, json!({ "type": "bot" }));
    let seats = state(&a).room.seats;
    assert_eq!(seats[0].avatar, "ab3z");
    assert_eq!(seats[1].avatar, "");
    assert_eq!(seats[2].avatar.len(), 16);
    assert!(
        seats[2]
            .avatar
            .chars()
            .all(|c| c.is_ascii_digit() || c.is_ascii_lowercase())
    );

    send(
        &mut rooms,
        &b,
        json!({ "type": "avatar", "avatar": "0123456789abcdefXYZ" }),
    );
    assert_eq!(state(&a).room.seats[1].avatar, "0123456789abcdef");
    let watcher = fake(&mut rooms, "10.0.0.3");
    send(&mut rooms, &watcher, json!({ "type": "join", "room": code }));
    send(&mut rooms, &watcher, json!({ "type": "avatar", "avatar": "1" }));
    assert_error(&watcher, "take a seat");
}

#[test]
fn limits_room_creation_per_address() {
    let mut rooms = Rooms::new(Options {
        create_limit: CreateLimit {
            count: 2,
            window_ms: 1000,
        },
        ..Options::default()
    })
    .unwrap();
    let a = fake(&mut rooms, "9.9.9.9");
    for _ in 0..3 {
        send(
            &mut rooms,
            &a,
            json!({ "type": "create", "theme": "box-office", "name": "a" }),
        );
    }
    assert_error(&a, "Too many");
    let b = fake(&mut rooms, "8.8.8.8");
    send(
        &mut rooms,
        &b,
        json!({ "type": "create", "theme": "box-office", "name": "b" }),
    );
    assert_eq!(last_error(&b), None);
}

#[test]
fn rooms_survive_a_restart_and_expire_after_the_ttl() {
    let dir = TmpDir::new("restart");
    let (now, opts) = clock(5_000_000);
    let mut rooms = rooms_in(&dir.0, opts);
    let (clients, code) = seated(&mut rooms, 3);
    send(&mut rooms, &clients[0], json!({ "type": "start" }));
    send(
        &mut rooms,
        &clients[0],
        json!({ "type": "settings", "settings": { "locked": true } }),
    );
    let token = joined(&clients[2]).2.unwrap();
    let before = game(&clients[2]);
    rooms.flush();
    assert_eq!(dir.files(), [format!("{code}.json")]);

    // What the Node server's loader checked, and the exact set of keys (the Node server wrote all
    // but bidTimerS and bidExtendS; a file without them loads with the defaults).
    let saved: Value = serde_json::from_slice(&fs::read(dir.0.join(format!("{code}.json"))).unwrap()).unwrap();
    assert_eq!(saved["v"], 1);
    assert_eq!(saved["code"], code.as_str());
    assert!(saved["seats"].is_array());
    assert_eq!(saved["bidTimerS"], 30);
    assert_eq!(saved["bidExtendS"], 10);
    let mut keys: Vec<&String> = saved.as_object().unwrap().keys().collect();
    keys.sort();
    assert_eq!(
        keys,
        [
            "admin",
            "bidExtendS",
            "bidTimerS",
            "cast",
            "code",
            "createdAt",
            "game",
            "seats",
            "settings",
            "theme",
            "updatedAt",
            "v"
        ]
    );

    let (_, opts) = clock(now.load(Ordering::SeqCst));
    let mut rooms = rooms_in(&dir.0, opts);
    let back = fake(&mut rooms, "10.0.0.5");
    send(
        &mut rooms,
        &back,
        json!({ "type": "join", "room": code, "token": token }),
    );
    assert_eq!(joined(&back).1, Some(2));
    assert_eq!(game(&back), before);
    assert!(state(&back).room.settings.locked);
    rooms.disconnect(back.id);
    drop(rooms);

    advance(&now, 8 * 24 * 3600 * 1000);
    let (_, opts) = clock(now.load(Ordering::SeqCst));
    let rooms = rooms_in(&dir.0, opts);
    assert_eq!(rooms.len(), 0);
    rooms.flush();
    assert_eq!(dir.files(), Vec::<String>::new());
}

/// A data directory the server cannot write to (a Docker volume owned by root, say) stops it at
/// startup with the reason, instead of failing every save while games go on.
#[test]
fn refuses_to_start_on_a_data_directory_it_cannot_write() {
    use std::os::unix::fs::PermissionsExt as _;

    let dir = TmpDir::new("read-only");
    fs::set_permissions(&dir.0, fs::Permissions::from_mode(0o555)).unwrap();
    // Root writes anyway; nothing to check then.
    if fs::write(dir.0.join("probe"), "").is_ok() {
        return;
    }
    let err = Rooms::new(Options {
        data_dir: Some(dir.0.clone()),
        ..Options::default()
    })
    .err()
    .expect("a read-only data directory is refused")
    .to_string();
    fs::set_permissions(&dir.0, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(err.contains(&dir.0.display().to_string()), "{err}");
    assert!(err.contains("mode 555"), "{err}");
    assert!(err.contains("runs as uid"), "{err}");
}

/// A file written by the Node server mid-game loads, keeps its seats and plays on.
#[test]
fn loads_a_room_saved_by_the_node_server() {
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../engine/fixtures/room.json");
    let saved: Value = serde_json::from_slice(&fs::read(&fixture).unwrap()).unwrap();
    let code = saved["code"].as_str().unwrap();
    let dir = TmpDir::new("node-room");
    fs::copy(&fixture, dir.0.join(format!("{code}.json"))).unwrap();
    // An unreadable file is skipped and left alone.
    fs::write(dir.0.join("BROKEN.json"), "{").unwrap();

    let (_, opts) = clock(1_700_000_000_000);
    let mut rooms = rooms_in(&dir.0, opts);
    assert_eq!(rooms.len(), 1);
    let seat = fake(&mut rooms, "10.0.0.1");
    let token = saved["seats"][1]["token"].as_str().unwrap();
    send(
        &mut rooms,
        &seat,
        json!({ "type": "join", "room": code, "token": token }),
    );
    assert_eq!(joined(&seat).1, Some(1));
    let s = state(&seat);
    assert_eq!(
        s.room.seats.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
        ["Asha", "Bilal", "Chitra"]
    );
    let view = s.game.unwrap();
    assert_eq!(view.log.len(), saved["game"]["log"].as_array().unwrap().len());
    assert_eq!(
        view.hand.len(),
        saved["game"]["players"][1]["hand"].as_array().unwrap().len()
    );
    assert!(dir.files().contains(&"BROKEN.json".to_owned()));
}
