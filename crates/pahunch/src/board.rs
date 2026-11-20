//! Boards, read from `boards.json`. A board is data: rooms with a capacity and a place to draw
//! them, paths that climb from room to room, the token mix and the setup per seat count. A new
//! board is a new entry in the file (the `boards` test checks it); the admin picks one per game.

use std::collections::BTreeMap;
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::types::{Bonus, Coin, Seat};

/// What a special coin is worth.
pub const SPECIAL: u8 = 2;

/// One room as a board defines it. `x`, `y` place it for drawing (0–100, `y` 0 at the top);
/// the rules never read them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(rename = "PahunchRoom")]
pub struct RoomDef {
    /// Seats in the room. The top room says 0: its size depends on the seat count.
    pub cap: u8,
    pub x: u16,
    pub y: u16,
}

/// A way up from one room to another (index into the board's rooms).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(rename = "PahunchPath")]
pub struct PathDef {
    pub from: u8,
    pub to: u8,
    /// A back path: locked unless the mover has a key lent; it never holds a token.
    #[serde(default)]
    pub back: bool,
}

/// What depends on the number of players.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct Seating {
    /// Climbers each player has.
    pub climbers: u8,
    /// Seats in the top room: the game ends when they are all taken.
    pub summit: u8,
    /// One neutral climber starts in each of these rooms.
    pub neutrals: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub id: String,
    pub name: String,
    /// Bottom to top: a path always climbs to a room later in the list.
    pub rooms: Vec<RoomDef>,
    pub paths: Vec<PathDef>,
    /// The path the blocker starts on.
    pub blocker: u8,
    /// Point tokens in the bag: value → how many.
    pub bag: BTreeMap<u8, u8>,
    /// Special coins in the bag, each worth [`SPECIAL`]: bonus → how many.
    #[serde(default)]
    pub specials: BTreeMap<Bonus, u8>,
    /// 1-point tokens in the supply, before each player takes their start.
    pub supply: u16,
    pub start_ones: u8,
    /// A neutral votes yes for one token of at least this value.
    pub min_bribe: u8,
    pub players: BTreeMap<u8, Seating>,
}

#[derive(Debug, Deserialize)]
struct BoardsFile {
    boards: Vec<Board>,
}

/// The board one game plays on, for its seat count: kept in the game's state, so a saved game
/// keeps its board when `boards.json` changes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "PahunchLayout")]
pub struct Layout {
    pub board: String,
    pub name: String,
    /// The top room's `cap` is set for the seat count.
    pub rooms: Vec<RoomDef>,
    pub paths: Vec<PathDef>,
    /// The top room: no path leaves it.
    pub summit: u8,
    pub min_bribe: u8,
}

impl Board {
    /// This board for `seating`.
    #[must_use]
    pub fn layout(&self, seating: &Seating) -> Layout {
        let summit = self.summit().unwrap_or(0);
        let rooms = self
            .rooms
            .iter()
            .enumerate()
            .map(|(i, r)| RoomDef {
                cap: if i == usize::from(summit) {
                    seating.summit
                } else {
                    r.cap
                },
                ..*r
            })
            .collect();
        Layout {
            board: self.id.clone(),
            name: self.name.clone(),
            rooms,
            paths: self.paths.clone(),
            summit,
            min_bribe: self.min_bribe,
        }
    }

    /// Every coin in the bag, unshuffled.
    #[must_use]
    pub fn coins(&self) -> Vec<Coin> {
        let plain = self
            .bag
            .iter()
            .flat_map(|(&value, &count)| std::iter::repeat_n(Coin::plain(value), usize::from(count)));
        let special = self.specials.iter().flat_map(|(&bonus, &count)| {
            std::iter::repeat_n(
                Coin {
                    value: SPECIAL,
                    bonus: Some(bonus),
                },
                usize::from(count),
            )
        });
        plain.chain(special).collect()
    }

    /// The one room no path leaves.
    fn summit(&self) -> Option<u8> {
        let tops: Vec<usize> = (0..self.rooms.len())
            .filter(|&r| self.paths.iter().all(|p| usize::from(p.from) != r))
            .collect();
        match tops.as_slice() {
            [top] => u8::try_from(*top).ok(),
            _ => None,
        }
    }

    /// What is wrong with the board, if anything.
    ///
    /// # Errors
    /// The first broken rule.
    pub fn check(&self) -> Result<(), String> {
        let rooms = self.rooms.len();
        if !(2..usize::from(u8::MAX)).contains(&rooms) {
            return Err(format!("{rooms} rooms"));
        }
        let summit = self.summit().ok_or("not exactly one room without a way up")?;
        for (i, p) in self.paths.iter().enumerate() {
            if usize::from(p.to) >= rooms || p.from >= p.to {
                return Err(format!("path {i} does not climb to a later room"));
            }
        }
        let slots = self.paths.iter().filter(|&&p| self.slot(p)).count();
        if slots < 2 || !self.paths.get(usize::from(self.blocker)).is_some_and(|&p| self.slot(p)) {
            return Err("the blocker needs a token path to start on and another to move to".into());
        }
        let bag = self.coins().len();
        if bag < slots {
            return Err(format!("{bag} bag tokens for {slots} token paths"));
        }
        for (i, r) in self.rooms.iter().enumerate() {
            if (i == usize::from(summit)) != (r.cap == 0) {
                return Err(format!("room {i}: only the top room has cap 0"));
            }
            if i != usize::from(summit) && !self.reaches_summit(i, summit) {
                return Err(format!("room {i} has no way to the top"));
            }
        }
        if !self.rooms.iter().enumerate().any(|(i, _)| self.entry(i)) {
            return Err("no room to enter".into());
        }
        if self.bag.keys().any(|&v| v < 2) || self.min_bribe < 2 {
            return Err("bag tokens and bribes are worth 2 or more (1s come from the supply)".into());
        }
        for (&n, s) in &self.players {
            let total = u16::from(n) * u16::from(s.climbers);
            if s.summit == 0 || u16::from(s.summit) > total {
                return Err(format!("{n} players: the top room cannot be filled"));
            }
            if u16::from(n) * u16::from(self.start_ones) > self.supply {
                return Err(format!("{n} players: the supply is too small for the start"));
            }
            for &r in &s.neutrals {
                let Some(room) = self.rooms.get(usize::from(r)).filter(|_| r != summit) else {
                    return Err(format!("{n} players: a neutral starts outside the board or at the top"));
                };
                #[expect(clippy::naive_bytecount, reason = "a handful of rooms")]
                let here = s.neutrals.iter().filter(|&&x| x == r).count();
                if here > usize::from(room.cap) {
                    return Err(format!("{n} players: room {r} cannot hold its neutrals"));
                }
            }
        }
        Ok(())
    }

    /// The path holds a token: it leaves a room of more than 1 and is not a back path.
    fn slot(&self, p: PathDef) -> bool {
        !p.back && self.rooms.get(usize::from(p.from)).is_some_and(|r| r.cap > 1)
    }

    /// Players put new climbers into rooms no path climbs to.
    fn entry(&self, room: usize) -> bool {
        self.paths.iter().all(|p| usize::from(p.to) != room)
    }

    fn reaches_summit(&self, room: usize, summit: u8) -> bool {
        let mut seen = vec![false; self.rooms.len()];
        let mut todo = vec![room];
        while let Some(r) = todo.pop() {
            if r == usize::from(summit) {
                return true;
            }
            if let Some(s) = seen.get_mut(r) {
                if *s {
                    continue;
                }
                *s = true;
            }
            todo.extend(
                self.paths
                    .iter()
                    .filter(|p| usize::from(p.from) == r)
                    .map(|p| usize::from(p.to)),
            );
        }
        false
    }
}

impl Layout {
    #[must_use]
    pub fn cap(&self, room: u8) -> u8 {
        self.rooms.get(usize::from(room)).map_or(0, |r| r.cap)
    }

    #[must_use]
    pub fn path(&self, path: u8) -> Option<PathDef> {
        self.paths.get(usize::from(path)).copied()
    }

    /// New climbers go into rooms no path climbs to.
    #[must_use]
    pub fn entry(&self, room: u8) -> bool {
        usize::from(room) < self.rooms.len() && room != self.summit && self.paths.iter().all(|p| p.to != room)
    }

    /// Yes votes it takes to leave `room`: more than half its seats.
    #[must_use]
    pub fn need(&self, room: u8) -> u8 {
        self.cap(room) / 2 + 1
    }

    /// The path holds a token: it leaves a room of more than 1 seat and is not a back path.
    #[must_use]
    pub fn slot(&self, path: u8) -> bool {
        self.path(path).is_some_and(|p| !p.back && self.cap(p.from) > 1)
    }

    /// The path is a back path.
    #[must_use]
    pub fn back(&self, path: u8) -> bool {
        self.path(path).is_some_and(|p| p.back)
    }

    #[must_use]
    pub fn room_count(&self) -> usize {
        self.rooms.len()
    }
}

static BOARDS: LazyLock<Vec<Board>> = LazyLock::new(|| {
    #[expect(clippy::expect_used, reason = "the file is compiled in; the boards test parses it")]
    let file: BoardsFile = serde_json::from_str(include_str!("../boards.json")).expect("boards.json is valid");
    file.boards
});

/// Every board, the default first.
#[must_use]
pub fn boards() -> &'static [Board] {
    &BOARDS
}

/// The seats in room order of one board: who holds each place.
pub type Rooms = Vec<Vec<Option<Seat>>>;
