//! The rules. Every function takes a state and returns a new one, so a refused move changes
//! nothing.
//!
//! A turn is one move: put a climber into a bottom room, climb one of yours a room up, nudge a
//! neutral up, or move the blocker. Leaving a room takes more than half its seats in yes votes:
//! your own climbers there say yes, every other player answers for theirs, and a neutral says
//! yes when the mover pays it a token. A climb by the blocker's path needs no vote but takes no
//! token. Back paths are locked. A special coin taken on a climb gives a bonus: one more move
//! after the main one, before the turn passes. With favours on, every player holds one favour
//! with two uses: they offer it to the mover, and earn 1s from the supply when it is used. The
//! game ends when the top room is full (neutrals count): of the players with a climber there, the
//! one with the most points wins (a tie goes to whoever arrived first); with none there, nobody
//! wins.

use rand::SeedableRng;
use rand::rngs::StdRng;

use crate::board::{Layout, Rooms, boards};
use crate::bot::choose_action;
use crate::types::{
    Action, Bonus, Bonuses, Carry, Coin, Deal, FavourKind, LogEntry, MAX_PLEA, Offer, Options, Player, Plea, RuleError,
    Seat, State, USES, Vote,
};
use crate::view::view_for;

const LOCKED: &str = "The back stairs are locked";

pub(crate) fn fail<T>(message: impl Into<String>) -> Result<T, RuleError> {
    Err(RuleError::new(message))
}

fn damaged() -> RuleError {
    RuleError::new("The game state is damaged")
}

/// A new game for `n` seats on board `variant`, with the default options.
///
/// # Errors
/// When the board does not exist or does not seat `n`.
pub fn new_game(n: u8, seed: u32, variant: u8) -> Result<State, RuleError> {
    new_game_with(n, seed, variant, Options::default())
}

/// A new game for `n` seats on board `variant`.
///
/// # Errors
/// When the board does not exist or does not seat `n`.
pub fn new_game_with(n: u8, seed: u32, variant: u8, options: Options) -> Result<State, RuleError> {
    let Some(board) = boards().get(usize::from(variant)) else {
        return fail("No such board");
    };
    let Some((side, seating)) = board.side(n).and_then(|s| Some((s, s.players.get(&n)?))) else {
        return fail(format!("Cannot play with {n} players"));
    };
    let layout = board.layout(side, seating);
    let mut random = game::rng(seed);
    let mut bag = game::shuffle(board.coins(), &mut random);
    let tokens_on = (0..u8::try_from(layout.paths.len()).unwrap_or(0))
        .map(|p| if layout.slot(p) { bag.pop() } else { None })
        .collect();
    let mut rooms: Rooms = vec![Vec::new(); layout.room_count()];
    for &r in &seating.neutrals {
        rooms.get_mut(usize::from(r)).ok_or_else(damaged)?.push(None);
    }
    let turn = u8::try_from(game::index(random(), n.into())).map_err(|_| damaged())?;
    // Drawn after the rest, so a game without favours sets up as before.
    let favours = if options.favours {
        game::shuffle(FavourKind::ALL.to_vec(), &mut random)
    } else {
        Vec::new()
    };
    Ok(State {
        n,
        seed,
        options,
        tried: Vec::new(),
        bonuses: Bonuses::default(),
        moved: false,
        lent: Vec::new(),
        used: Vec::new(),
        asked: Vec::new(),
        withdrawn: Vec::new(),
        pleas: Vec::new(),
        offers: Vec::new(),
        layout,
        rooms,
        tokens_on,
        blocker: side.blocker,
        bag,
        supply: board.supply.saturating_sub(u16::from(n) * u16::from(board.start_ones)),
        players: (0..usize::from(n))
            .map(|i| {
                let favour = favours.get(i).copied();
                Player {
                    hand: seating.climbers,
                    tokens: vec![1; usize::from(board.start_ones)],
                    favour,
                    uses: if favour.is_some() { USES } else { 0 },
                }
            })
            .collect(),
        turn,
        vote: None,
        log: vec![LogEntry::Start { first: turn }],
        over: false,
        winners: Vec::new(),
        skips: 0,
    })
}

// ---- the board, as both the rules and the bot read it ----

/// Climbers of `who` in `room` (`None` = neutrals).
pub(crate) fn count(rooms: &Rooms, room: u8, who: Option<Seat>) -> u8 {
    let n = rooms
        .get(usize::from(room))
        .map_or(0, |r| r.iter().filter(|&&x| x == who).count());
    u8::try_from(n).unwrap_or(u8::MAX)
}

fn held(rooms: &Rooms, room: u8) -> usize {
    rooms.get(usize::from(room)).map_or(0, Vec::len)
}

/// Whether `pieces` more fit into `room`: `Some(false)` as it is, `Some(true)` only with one
/// squeezed in by a lent favour (one extra at most, never at the top).
fn room_for(layout: &Layout, rooms: &Rooms, room: u8, pieces: usize, lent: &[FavourKind]) -> Option<bool> {
    let after = held(rooms, room) + pieces;
    let cap = usize::from(layout.cap(room));
    if after <= cap {
        Some(false)
    } else if room != layout.summit && lent.contains(&FavourKind::SqueezeIn) && after <= cap + 1 {
        Some(true)
    } else {
        None
    }
}

/// The favours on offer to the mover: those lent with a use left.
pub(crate) fn offered(lent: &[Seat], favour_of: impl Fn(Seat) -> Option<(FavourKind, u8)>) -> Vec<FavourKind> {
    lent.iter()
        .filter_map(|&o| favour_of(o).filter(|&(_, uses)| uses > 0).map(|(k, _)| k))
        .collect()
}

fn offered_in(s: &State) -> Vec<FavourKind> {
    offered(&s.lent, |o| {
        s.players
            .get(usize::from(o))
            .and_then(|p| p.favour.map(|k| (k, p.uses)))
    })
}

fn on_offer(s: &State, kind: FavourKind) -> bool {
    offered_in(s).contains(&kind)
}

/// Tokens the mover could pay a neutral with.
fn bribe_tokens(layout: &Layout, tokens: &[u8]) -> usize {
    tokens.iter().filter(|&&t| t >= layout.min_bribe).count()
}

/// How a climb goes, if it may start.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Climb {
    /// The blocker is on the path: no vote, no token (unless a lent favour takes it).
    Blocked,
    /// A back path, opened by a lent favour: no vote, no token.
    Back,
    /// Enough of the mover's own climbers are there.
    Own,
    /// A vote decides.
    Ask { need: u8, own: u8 },
}

/// A new climber into `room`; `true` when it squeezes in by a lent favour.
pub(crate) fn check_enter(
    layout: &Layout,
    rooms: &Rooms,
    hand: u8,
    room: u8,
    lent: &[FavourKind],
) -> Result<bool, RuleError> {
    if hand == 0 {
        return fail("All your climbers are on the board");
    }
    if !layout.entry(room) {
        return fail("New climbers go into a bottom room");
    }
    room_for(layout, rooms, room, 1, lent).ok_or_else(|| RuleError::new("That room is full"))
}

/// Where a climb starts from: the board, what this turn has already tried, and the favours on
/// offer.
pub(crate) struct Board<'a> {
    pub layout: &'a Layout,
    pub rooms: &'a Rooms,
    pub tokens_on: &'a [Option<Coin>],
    pub blocker: u8,
    pub tried: &'a [u8],
    pub lent: &'a [FavourKind],
}

impl Board<'_> {
    fn has(&self, kind: FavourKind) -> bool {
        self.lent.contains(&kind)
    }

    /// A coin lies on `path` where a climb could take it.
    fn coin(&self, path: u8) -> bool {
        self.layout.slot(path) && self.tokens_on.get(usize::from(path)).is_some_and(Option::is_some)
    }
}

/// What a climb asks for, the vote aside.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Ask {
    pub path: u8,
    pub swap: Option<u8>,
    pub carry: Option<Carry>,
}

/// The parts of a climb the board decides: the path is open, the pieces fit above, and the
/// favours it would use are on offer.
fn climb_parts(b: &Board<'_>, seat: Seat, ask: Ask) -> Result<Vec<FavourKind>, RuleError> {
    let Ask { path, swap, carry } = ask;
    let Some(p) = b.layout.path(path) else {
        return fail("No such path");
    };
    let mut uses = Vec::new();
    if p.back {
        if !b.has(FavourKind::BackStairs) {
            return fail(LOCKED);
        }
        uses.push(FavourKind::BackStairs);
    }
    let own = count(b.rooms, p.from, Some(seat));
    if own == 0 {
        return fail("You have no climber at the foot of that path");
    }
    if let Some(c) = carry {
        if !b.has(FavourKind::Carry) {
            return fail("Nobody offers to take a piece along");
        }
        let here = count(b.rooms, p.from, c.who());
        if here < if c.who() == Some(seat) { 2 } else { 1 } {
            return fail("That piece is not in the room");
        }
        uses.push(FavourKind::Carry);
    }
    let pieces = 1 + usize::from(carry.is_some());
    match room_for(b.layout, b.rooms, p.to, pieces, b.lent) {
        None => return fail("The room above is full"),
        Some(true) => uses.push(FavourKind::SqueezeIn),
        Some(false) => {}
    }
    let covered = path == b.blocker && b.coin(path) && b.has(FavourKind::CoveredToken);
    let takes = b.coin(path) && (path != b.blocker || covered);
    if let Some(other) = swap {
        if !b.has(FavourKind::SwapToken) {
            return fail("Nobody offers a token swap");
        }
        if !takes {
            return fail("That climb takes no token to swap");
        }
        if other == path || other == b.blocker || !b.coin(other) {
            return fail("Swap for another uncovered token on the board");
        }
        uses.push(FavourKind::SwapToken);
    } else if covered {
        uses.push(FavourKind::CoveredToken);
    }
    Ok(uses)
}

/// How the climb goes, if it may start.
pub(crate) fn check_climb(b: &Board<'_>, seat: Seat, tokens: &[u8], ask: Ask) -> Result<Climb, RuleError> {
    climb_parts(b, seat, ask)?;
    let Board {
        layout, rooms, tried, ..
    } = *b;
    let path = ask.path;
    let p = layout.path(path).ok_or_else(damaged)?;
    if p.back {
        return Ok(Climb::Back);
    }
    if path == b.blocker {
        return Ok(Climb::Blocked);
    }
    let own = count(rooms, p.from, Some(seat));
    let need = layout.need(p.from);
    if own >= need {
        return Ok(Climb::Own);
    }
    if tried.contains(&p.from) {
        return fail("That room already said no this turn");
    }
    let others = rooms
        .get(usize::from(p.from))
        .map_or(0, |r| r.iter().filter(|x| x.is_some_and(|s| s != seat)).count());
    let neutrals = usize::from(count(rooms, p.from, None)).min(bribe_tokens(layout, tokens));
    if usize::from(own) + others + neutrals < usize::from(need) {
        return fail(format!(
            "Leaving takes {need} yes votes; there are not enough voters in the room"
        ));
    }
    Ok(Climb::Ask { need, own })
}

/// A neutral up `path`: the favours it would use.
pub(crate) fn check_nudge(
    layout: &Layout,
    rooms: &Rooms,
    path: u8,
    lent: &[FavourKind],
) -> Result<Vec<FavourKind>, RuleError> {
    let Some(p) = layout.path(path) else {
        return fail("No such path");
    };
    let mut uses = Vec::new();
    if p.back {
        if !lent.contains(&FavourKind::BackStairs) {
            return fail(LOCKED);
        }
        uses.push(FavourKind::BackStairs);
    }
    if count(rooms, p.from, None) == 0 {
        return fail("No neutral at the foot of that path");
    }
    match room_for(layout, rooms, p.to, 1, lent) {
        None => return fail("The room above is full"),
        Some(true) => uses.push(FavourKind::SqueezeIn),
        Some(false) => {}
    }
    Ok(uses)
}

pub(crate) fn check_block(layout: &Layout, blocker: u8, path: u8) -> Result<(), RuleError> {
    if layout.path(path).is_none() {
        return fail("No such path");
    }
    if path == blocker {
        return fail("The blocker is already there");
    }
    if !layout.slot(path) {
        return fail("The blocker sits only on a path with a token");
    }
    Ok(())
}

/// Seats that still owe an answer to the vote.
pub(crate) fn voters_left(rooms: &Rooms, vote: &Vote, mover: Seat) -> Vec<Seat> {
    let n = u8::try_from(vote.answers.len()).unwrap_or(0);
    (0..n)
        .filter(|&s| s != mover && count(rooms, vote.room, Some(s)) > 0)
        .filter(|&s| vote.answers.get(usize::from(s)).is_some_and(Option::is_none))
        .collect()
}

/// The mover can still pay a neutral.
pub(crate) fn can_bribe(layout: &Layout, rooms: &Rooms, vote: &Vote, tokens: &[u8]) -> bool {
    count(rooms, vote.room, None) > vote.bribed && bribe_tokens(layout, tokens) > 0
}

// ---- moves ----

/// Seats that owe a move: the mover (or the voters while a vote runs), the owners the mover
/// asked for their favour, and the players a deal waits on.
#[must_use]
pub fn pending(s: &State) -> Vec<Seat> {
    if s.over {
        return Vec::new();
    }
    let mut owe = match &s.vote {
        None => vec![s.turn],
        Some(v) => {
            let mut left = voters_left(&s.rooms, v, s.turn);
            // Enough yes in: the mover may take them now.
            if left.is_empty() || enough(v) {
                left.push(s.turn);
            }
            left
        }
    };
    let deals = s.pleas.iter().map(|p| p.of).chain(s.offers.iter().map(|o| o.to));
    for o in s.asked.iter().copied().chain(deals) {
        if !owe.contains(&o) {
            owe.push(o);
        }
    }
    owe
}

/// One move by `seat`.
///
/// # Errors
/// When the move breaks the rules.
pub fn apply_action(prev: &State, seat: Seat, action: &Action) -> Result<State, RuleError> {
    if prev.over {
        return fail("The game is over");
    }
    if seat >= prev.n {
        return fail("No such seat");
    }
    let mut s = prev.clone();
    if any_time(&mut s, seat, action)? {
        return Ok(s);
    }
    if s.vote.is_some() {
        in_vote(&mut s, seat, action)?;
        return Ok(s);
    }
    if seat != s.turn {
        return fail("It is not your turn");
    }
    if s.moved {
        extra_move(&mut s, seat, action)?;
        return Ok(s);
    }
    let me = usize::from(seat);
    match *action {
        Action::Enter { room } => {
            let hand = s.players.get(me).ok_or_else(damaged)?.hand;
            if check_enter(&s.layout, &s.rooms, hand, room, &offered_in(&s))? {
                spend(&mut s, FavourKind::SqueezeIn)?;
            }
            s.rooms.get_mut(usize::from(room)).ok_or_else(damaged)?.push(Some(seat));
            if let Some(p) = s.players.get_mut(me) {
                p.hand -= 1;
            }
            s.log.push(LogEntry::Enter { p: seat, room });
            arrive(&mut s, room);
            end_move(&mut s);
        }
        Action::Climb { path, swap, carry } => {
            let ask = Ask { path, swap, carry };
            let tokens = &s.players.get(me).ok_or_else(damaged)?.tokens;
            let lent = offered_in(&s);
            match check_climb(&board(&s, &lent), seat, tokens, ask)? {
                Climb::Blocked | Climb::Own | Climb::Back => climb(&mut s, seat, ask, true)?,
                Climb::Ask { need, own } => {
                    let room = s.layout.path(path).ok_or_else(damaged)?.from;
                    let mut answers = vec![None; usize::from(s.n)];
                    if let Some(a) = answers.get_mut(me) {
                        *a = Some(own);
                    }
                    s.vote = Some(Vote {
                        room,
                        path,
                        need,
                        answers,
                        bribed: 0,
                        start: u32::try_from(s.log.len()).unwrap_or(u32::MAX),
                        swap,
                        carry,
                    });
                    s.log.push(LogEntry::Ask { p: seat, path, need });
                }
            }
        }
        Action::Nudge { path } => {
            nudge(&mut s, seat, path)?;
            end_move(&mut s);
        }
        Action::Block { path } => {
            block(&mut s, seat, path)?;
            // A lent favour moves the blocker on top of the main move.
            if on_offer(&s, FavourKind::ExtraBlock) {
                spend(&mut s, FavourKind::ExtraBlock)?;
            } else {
                end_move(&mut s);
            }
        }
        Action::Done => return fail("Make your move first"),
        Action::Vote { .. } | Action::Bribe { .. } | Action::Withdraw | Action::Take { .. } => {
            return fail("No vote is running");
        }
        Action::Unknown => return fail("Unknown move"),
        Action::Give { .. }
        | Action::Lend { .. }
        | Action::Request { .. }
        | Action::Decline
        | Action::Plead { .. }
        | Action::Offer { .. }
        | Action::Accept { .. }
        | Action::Refuse { .. }
        | Action::Recall { .. } => {}
    }
    Ok(s)
}

/// A move while a vote runs: an answer, or the mover's bribe, take or giving up.
fn in_vote(s: &mut State, seat: Seat, action: &Action) -> Result<(), RuleError> {
    match action {
        &Action::Vote { yes } => answer(s, seat, yes),
        &Action::Bribe { token } => bribe(s, seat, token),
        Action::Take { votes } => take(s, seat, votes),
        Action::Withdraw => {
            if seat != s.turn {
                return fail("Only the climber can give up the climb");
            }
            failed(s);
            Ok(())
        }
        Action::Unknown => fail("Unknown move"),
        _ => fail("Wait for the vote to finish"),
    }
}

/// Moves that wait for nothing (gifts, deals and favours): `true` when `action` was one.
fn any_time(s: &mut State, seat: Seat, action: &Action) -> Result<bool, RuleError> {
    match action {
        Action::Give { to, tokens } => give(s, seat, *to, tokens)?,
        &Action::Lend { on } => lend(s, seat, on)?,
        &Action::Request { owner, on } => request(s, seat, owner, on)?,
        Action::Decline => {
            if !s.asked.contains(&seat) {
                return fail("Nobody asked for your favour");
            }
            s.asked.retain(|&o| o != seat);
            s.log.push(LogEntry::Decline { p: seat });
        }
        &Action::Plead { of, count } => plead(s, seat, of, count)?,
        Action::Offer { to, give, want } => offer(s, seat, *to, give, want)?,
        &Action::Accept { from } => accept(s, seat, from)?,
        &Action::Refuse { from, deal } => {
            if !close(s, from, seat, deal) {
                return fail("They opened no such deal with you");
            }
            s.log.push(LogEntry::Refuse {
                p: seat,
                to: from,
                deal,
            });
        }
        &Action::Recall { to, deal } => {
            if !close(s, seat, to, deal) {
                return fail("You opened no such deal with them");
            }
            s.log.push(LogEntry::Recall { p: seat, to, deal });
        }
        _ => return Ok(false),
    }
    Ok(true)
}

fn board<'a>(s: &'a State, lent: &'a [FavourKind]) -> Board<'a> {
    Board {
        layout: &s.layout,
        rooms: &s.rooms,
        tokens_on: &s.tokens_on,
        blocker: s.blocker,
        tried: refused_rooms(s.options, &s.tried),
        lent,
    }
}

/// Rooms that hold no second vote this turn: those that said no, in strict games only.
pub(crate) fn refused_rooms(options: Options, tried: &[u8]) -> &[u8] {
    if options.one_vote_per_room { tried } else { &[] }
}

/// The mover uses the lent favour of `kind`: its owner loses a use and earns its pay.
fn spend(s: &mut State, kind: FavourKind) -> Result<(), RuleError> {
    let owner = *s
        .lent
        .iter()
        .find(|&&o| {
            s.players
                .get(usize::from(o))
                .is_some_and(|p| p.favour == Some(kind) && p.uses > 0)
        })
        .ok_or_else(damaged)?;
    s.lent.retain(|&o| o != owner);
    s.used.push(owner);
    if let Some(p) = s.players.get_mut(usize::from(owner)) {
        p.uses -= 1;
    }
    s.log.push(LogEntry::Favour {
        owner,
        user: s.turn,
        kind,
    });
    let pay = s.layout.pay(kind);
    reward(s, owner, pay);
    Ok(())
}

/// Offer `seat`'s favour to the mover, or take an unused offer back.
fn lend(s: &mut State, seat: Seat, on: bool) -> Result<(), RuleError> {
    if !s.options.favours {
        return fail("Favours are off this game");
    }
    let p = s.players.get(usize::from(seat)).ok_or_else(damaged)?;
    if p.favour.is_none() {
        return fail("You have no favour");
    }
    if on {
        if seat == s.turn {
            return fail("A favour helps another player's move");
        }
        if s.lent.contains(&seat) {
            return fail("Your favour is on offer already");
        }
        if s.used.contains(&seat) {
            return fail("Your favour was used this turn");
        }
        if p.uses == 0 {
            return fail("Your favour is used up");
        }
        if s.options.one_vote_per_room && s.withdrawn.contains(&seat) {
            return fail("Strict game: your favour was offered once this turn");
        }
        s.lent.push(seat);
        // Offering it answers yes to the mover's request.
        s.asked.retain(|&o| o != seat);
    } else {
        if !s.lent.contains(&seat) {
            return fail("Your favour is not on offer");
        }
        if s.vote.is_some() {
            return fail("Wait for the vote to finish");
        }
        s.lent.retain(|&o| o != seat);
        s.withdrawn.push(seat);
    }
    Ok(())
}

/// The mover asks `owner` for their favour (`on`), or takes the request back. The owner answers
/// by lending it or by declining; the mover's own move does not wait for the answer. Off on a
/// favour already on offer turns the offer down: the mover's climbs no longer use it.
fn request(s: &mut State, seat: Seat, owner: Seat, on: bool) -> Result<(), RuleError> {
    if !s.options.favours {
        return fail("Favours are off this game");
    }
    if seat != s.turn {
        return fail("Ask for a favour on your own turn");
    }
    if !on {
        if s.lent.contains(&owner) {
            if s.vote.is_some() {
                return fail("Wait for the vote to finish");
            }
            s.lent.retain(|&o| o != owner);
            s.withdrawn.push(owner);
            return Ok(());
        }
        if !s.asked.contains(&owner) {
            return fail("You did not ask for that favour");
        }
        s.asked.retain(|&o| o != owner);
        return Ok(());
    }
    if s.vote.is_some() {
        return fail("Wait for the vote to finish");
    }
    if owner == seat {
        return fail("A favour helps another player's move");
    }
    let Some(p) = s.players.get(usize::from(owner)) else {
        return fail("No such seat");
    };
    if p.favour.is_none() {
        return fail("They have no favour");
    }
    if s.asked.contains(&owner) {
        return fail("You asked already");
    }
    if s.lent.contains(&owner) {
        return fail("Their favour is on offer already");
    }
    if s.used.contains(&owner) {
        return fail("Their favour was used this turn");
    }
    if p.uses == 0 {
        return fail("Their favour is used up");
    }
    if s.options.one_vote_per_room && s.withdrawn.contains(&owner) {
        return fail("Strict game: their favour was offered once this turn");
    }
    s.asked.push(owner);
    s.log.push(LogEntry::Request { p: seat, owner });
    Ok(())
}

/// A climber of the mover's reached `room`: a lent favour lets it climb on from a 1-room.
fn arrive(s: &mut State, room: u8) {
    if room != s.layout.summit && s.layout.cap(room) == 1 && on_offer(s, FavourKind::ClimbAgain) {
        s.bonuses.climb_again = Some(room);
    }
}

fn nudge(s: &mut State, seat: Seat, path: u8) -> Result<(), RuleError> {
    for kind in check_nudge(&s.layout, &s.rooms, path, &offered_in(s))? {
        spend(s, kind)?;
    }
    let p = s.layout.path(path).ok_or_else(damaged)?;
    move_piece(&mut s.rooms, p.from, p.to, None)?;
    s.log.push(LogEntry::Nudge { p: seat, path });
    reward(s, seat, 1);
    Ok(())
}

fn block(s: &mut State, seat: Seat, path: u8) -> Result<(), RuleError> {
    check_block(&s.layout, s.blocker, path)?;
    s.blocker = path;
    s.log.push(LogEntry::Block { p: seat, path });
    Ok(())
}

/// A move after the main one: a bonus, a lent favour, or the end of the turn.
fn extra_move(s: &mut State, seat: Seat, action: &Action) -> Result<(), RuleError> {
    match *action {
        Action::Block { path } if s.bonuses.block > 0 => {
            block(s, seat, path)?;
            s.bonuses.block -= 1;
        }
        Action::Block { path } if on_offer(s, FavourKind::ExtraBlock) => {
            block(s, seat, path)?;
            spend(s, FavourKind::ExtraBlock)?;
        }
        Action::Nudge { path } if s.bonuses.nudge > 0 => {
            nudge(s, seat, path)?;
            s.bonuses.nudge -= 1;
        }
        Action::Climb { path, swap, carry } if climbs_again(s) => {
            let room = s.bonuses.climb_again.ok_or_else(damaged)?;
            if carry.is_some() {
                return fail("A climb on takes nobody along");
            }
            if s.layout.path(path).is_none_or(|p| p.from != room) {
                return fail("Climb on with the climber that just arrived");
            }
            let ask = Ask { path, swap, carry };
            let tokens = &s.players.get(usize::from(seat)).ok_or_else(damaged)?.tokens;
            let lent = offered_in(s);
            if let Climb::Ask { .. } = check_climb(&board(s, &lent), seat, tokens, ask)? {
                return fail("That climb needs a vote");
            }
            s.bonuses.climb_again = None;
            spend(s, FavourKind::ClimbAgain)?;
            return climb(s, seat, ask, true);
        }
        Action::Done => {
            s.log.push(LogEntry::Done { p: seat });
            next_turn(s);
            return Ok(());
        }
        Action::Unknown => return fail("Unknown move"),
        _ => return fail("Use an extra move or end the turn"),
    }
    end_move(s);
    Ok(())
}

fn climbs_again(s: &State) -> bool {
    s.bonuses.climb_again.is_some() && on_offer(s, FavourKind::ClimbAgain)
}

/// The mover has extra moves left after the main one.
fn extras(s: &State) -> bool {
    s.bonuses.block > 0 || s.bonuses.nudge > 0 || climbs_again(s) || on_offer(s, FavourKind::ExtraBlock)
}

/// `hand` without `tokens` (by value), sorted; `None` when the hand lacks them.
fn without(hand: &[u8], tokens: &[u8]) -> Option<Vec<u8>> {
    let mut left = hand.to_vec();
    for t in tokens {
        let at = left.iter().position(|x| x == t)?;
        left.swap_remove(at);
    }
    left.sort_unstable();
    Some(left)
}

fn tokens_of(s: &State, seat: Seat) -> Result<&[u8], RuleError> {
    Ok(&s.players.get(usize::from(seat)).ok_or_else(damaged)?.tokens)
}

/// `tokens` move from `from` to `to`; the caller checked `from` holds them.
fn hand_over(s: &mut State, from: Seat, to: Seat, tokens: &[u8]) -> Result<(), RuleError> {
    let left = without(tokens_of(s, from)?, tokens).ok_or_else(damaged)?;
    if let Some(p) = s.players.get_mut(usize::from(from)) {
        p.tokens = left;
    }
    let p = s.players.get_mut(usize::from(to)).ok_or_else(damaged)?;
    p.tokens.extend_from_slice(tokens);
    p.tokens.sort_unstable();
    Ok(())
}

fn other_seat(s: &State, me: Seat, other: Seat, message: &str) -> Result<(), RuleError> {
    if other == me || other >= s.n {
        return fail(message);
    }
    Ok(())
}

fn count_of(tokens: &[u8]) -> u8 {
    u8::try_from(tokens.len()).unwrap_or(u8::MAX)
}

/// A gift; one from the player asked answers their open ask.
fn give(s: &mut State, from: Seat, to: Seat, tokens: &[u8]) -> Result<(), RuleError> {
    other_seat(s, from, to, "Give to another player")?;
    if tokens.is_empty() {
        return fail("Pick the tokens to give");
    }
    if without(tokens_of(s, from)?, tokens).is_none() {
        return fail("You do not have those tokens");
    }
    hand_over(s, from, to, tokens)?;
    s.pleas.retain(|p| !(p.by == to && p.of == from));
    s.log.push(LogEntry::Gift {
        from,
        to,
        count: count_of(tokens),
    });
    drop_stale(s);
    // The mover may have given away the token a bribe needed.
    settle(s)
}

/// `by` asks `of` for `count` tokens.
fn plead(s: &mut State, by: Seat, of: Seat, count: u8) -> Result<(), RuleError> {
    other_seat(s, by, of, "Ask another player")?;
    if !(1..=MAX_PLEA).contains(&count) {
        return fail(format!("Ask for 1 to {MAX_PLEA} tokens"));
    }
    if s.pleas.iter().any(|p| p.by == by && p.of == of) {
        return fail("You asked them already");
    }
    s.pleas.push(Plea { by, of, count });
    s.log.push(LogEntry::Plea { p: by, of, count });
    Ok(())
}

/// `by` offers `to` a swap.
fn offer(s: &mut State, by: Seat, to: Seat, give: &[u8], want: &[u8]) -> Result<(), RuleError> {
    other_seat(s, by, to, "Offer to another player")?;
    if give.is_empty() || want.is_empty() {
        return fail("A swap needs tokens both ways");
    }
    if want.contains(&0) {
        return fail("No token is worth 0");
    }
    if without(tokens_of(s, by)?, give).is_none() {
        return fail("You do not have those tokens");
    }
    if s.offers.iter().any(|o| o.by == by && o.to == to) {
        return fail("You have an offer open with them already");
    }
    s.offers.push(Offer {
        by,
        to,
        give: give.to_vec(),
        want: want.to_vec(),
    });
    s.log.push(LogEntry::Offer {
        p: by,
        to,
        give: count_of(give),
        want: count_of(want),
    });
    Ok(())
}

/// `me` takes the swap `from` offered.
fn accept(s: &mut State, me: Seat, from: Seat) -> Result<(), RuleError> {
    let Some(at) = s.offers.iter().position(|o| o.by == from && o.to == me) else {
        return fail("They offer you no swap");
    };
    let o = s.offers.get(at).cloned().ok_or_else(damaged)?;
    if without(tokens_of(s, me)?, &o.want).is_none() {
        return fail("You do not have the tokens they want");
    }
    if without(tokens_of(s, from)?, &o.give).is_none() {
        return fail("They no longer have the tokens they offered");
    }
    hand_over(s, from, me, &o.give)?;
    hand_over(s, me, from, &o.want)?;
    s.offers.remove(at);
    s.log.push(LogEntry::Trade {
        from,
        to: me,
        gave: count_of(&o.give),
        got: count_of(&o.want),
    });
    drop_stale(s);
    // Either side may be the mover, short of a bribe now.
    settle(s)
}

/// Tokens left a hand: an offer whose maker no longer holds what it gives ends, as taken back.
fn drop_stale(s: &mut State) {
    let (keep, gone): (Vec<Offer>, Vec<Offer>) = std::mem::take(&mut s.offers).into_iter().partition(|o| {
        s.players
            .get(usize::from(o.by))
            .is_some_and(|p| without(&p.tokens, &o.give).is_some())
    });
    s.offers = keep;
    for o in gone {
        s.log.push(LogEntry::Recall {
            p: o.by,
            to: o.to,
            deal: Deal::Offer,
        });
    }
}

/// The deal between `by` and `to` ends: `p` refused it or took it back.
fn close(s: &mut State, by: Seat, to: Seat, deal: Deal) -> bool {
    let before = s.pleas.len() + s.offers.len();
    match deal {
        Deal::Plea => s.pleas.retain(|p| !(p.by == by && p.of == to)),
        Deal::Offer => s.offers.retain(|o| !(o.by == by && o.to == to)),
    }
    s.pleas.len() + s.offers.len() < before
}

/// A deal someone opened with `seat`, oldest first.
fn deal_for(s: &State, seat: Seat) -> Option<(Seat, Deal)> {
    let plea = s.pleas.iter().find(|p| p.of == seat).map(|p| (p.by, Deal::Plea));
    plea.or_else(|| s.offers.iter().find(|o| o.to == seat).map(|o| (o.by, Deal::Offer)))
}

fn answer(s: &mut State, seat: Seat, yes: u8) -> Result<(), RuleError> {
    let vote = s.vote.as_ref().ok_or_else(damaged)?;
    if !voters_left(&s.rooms, vote, s.turn).contains(&seat) {
        return fail(if seat == s.turn {
            "Your own climbers already say yes"
        } else {
            "You have no vote to give in this climb"
        });
    }
    let of = count(&s.rooms, vote.room, Some(seat));
    if yes > of {
        return fail(format!("You have {of} votes here"));
    }
    if let Some(a) = s.vote.as_mut().and_then(|v| v.answers.get_mut(usize::from(seat))) {
        *a = Some(yes);
    }
    s.log.push(LogEntry::Vote { p: seat, yes, of });
    settle(s)
}

fn bribe(s: &mut State, seat: Seat, token: u8) -> Result<(), RuleError> {
    if seat != s.turn {
        return fail("Only the climber pays neutrals");
    }
    let vote = s.vote.as_ref().ok_or_else(damaged)?;
    if count(&s.rooms, vote.room, None) <= vote.bribed {
        return fail("No neutral left to pay in that room");
    }
    if token < s.layout.min_bribe {
        return fail(format!("A neutral takes a token of {} or more", s.layout.min_bribe));
    }
    let tokens = &mut s.players.get_mut(usize::from(seat)).ok_or_else(damaged)?.tokens;
    let Some(at) = tokens.iter().position(|&t| t == token) else {
        return fail("You do not have that token");
    };
    tokens.remove(at);
    if let Some(v) = s.vote.as_mut() {
        v.bribed += 1;
    }
    s.log.push(LogEntry::Bribe { p: seat });
    drop_stale(s);
    settle(s)
}

/// Yes votes from other players the climb still needs, past the mover's own and the paid neutrals.
pub(crate) fn still_needed(vote: &Vote, mover: Seat) -> u8 {
    let own = vote.answers.get(usize::from(mover)).copied().flatten().unwrap_or(0);
    vote.need.saturating_sub(own.saturating_add(vote.bribed))
}

/// Enough yes are in: the mover may take the needed ones now, without waiting for the rest.
pub(crate) fn enough(vote: &Vote) -> bool {
    vote.yes() >= vote.need
}

/// The needed yes, taken from the voters in seat order after the mover: what the vote clock picks
/// when the mover has not.
pub(crate) fn first_yes(vote: &Vote, mover: Seat) -> Vec<u8> {
    let n = vote.answers.len();
    let mut left = still_needed(vote, mover);
    let mut take = vec![0; n];
    for k in 1..n {
        let i = (usize::from(mover) + k) % n;
        let given = vote.answers.get(i).copied().flatten().unwrap_or(0).min(left);
        if let Some(t) = take.get_mut(i) {
            *t = given;
        }
        left -= given;
    }
    take
}

/// When the answers leave the mover no choice of whose yes earn the 1s: every other voter has
/// answered, and either no yes is spare or only one player said yes.
fn no_choice(rooms: &Rooms, vote: &Vote, mover: Seat) -> Option<Vec<u8>> {
    if !voters_left(rooms, vote, mover).is_empty() {
        return None;
    }
    let givers = vote
        .answers
        .iter()
        .enumerate()
        .filter(|&(i, a)| i != usize::from(mover) && a.is_some_and(|y| y > 0))
        .count();
    (vote.yes() == vote.need || givers <= 1).then(|| first_yes(vote, mover))
}

/// After a change to the running vote. The mover's own climbers and paid neutrals alone carry it:
/// it passes. Enough yes from the others: it passes when the answers leave no choice of whose yes
/// earn the 1s; else the mover takes the needed ones (any time once enough are in, without waiting
/// for the rest). Not enough, and nothing can bring them in: it fails.
fn settle(s: &mut State) -> Result<(), RuleError> {
    let Some(vote) = s.vote.clone() else { return Ok(()) };
    let mover = s.turn;
    if still_needed(&vote, mover) == 0 {
        return pass(s, &vote, &vec![0; vote.answers.len()]);
    }
    if enough(&vote) {
        if let Some(take) = no_choice(&s.rooms, &vote, mover) {
            return pass(s, &vote, &take);
        }
        return Ok(());
    }
    let tokens = &s.players.get(usize::from(mover)).ok_or_else(damaged)?.tokens;
    if voters_left(&s.rooms, &vote, mover).is_empty() && !can_bribe(&s.layout, &s.rooms, &vote, tokens) {
        failed(s);
    }
    Ok(())
}

/// The mover takes the yes in `take` (per seat; their own entry is ignored): exactly the ones the
/// climb still needs, each from a voter who gave at least that many. Only those earn the 1s.
fn take(s: &mut State, seat: Seat, take: &[u8]) -> Result<(), RuleError> {
    if seat != s.turn {
        return fail("Only the climber picks whose votes count");
    }
    let vote = s.vote.clone().ok_or_else(damaged)?;
    if !enough(&vote) {
        return fail("Not enough yes votes yet");
    }
    if take.len() != vote.answers.len() {
        return fail("Name a count for every seat");
    }
    let mut sum = 0_u8;
    for (i, (&t, a)) in take.iter().zip(&vote.answers).enumerate() {
        if i == usize::from(seat) {
            continue;
        }
        if t > a.unwrap_or(0) {
            return fail("Take only yes votes that were given");
        }
        sum = sum.saturating_add(t);
    }
    let need = still_needed(&vote, seat);
    if sum != need {
        return fail(format!("Take exactly the {need} yes votes the climb still needs"));
    }
    let mut take = take.to_vec();
    if let Some(t) = take.get_mut(usize::from(seat)) {
        *t = 0;
    }
    pass(s, &vote, &take)
}

/// The vote passes: the taken yes earn their givers 1s, and the climb goes.
fn pass(s: &mut State, vote: &Vote, take: &[u8]) -> Result<(), RuleError> {
    let mover = s.turn;
    for (i, &t) in take.iter().enumerate() {
        if let Ok(seat) = Seat::try_from(i)
            && seat != mover
            && t > 0
        {
            reward(s, seat, t);
        }
    }
    s.vote = None;
    let ask = Ask {
        path: vote.path,
        swap: vote.swap,
        carry: vote.carry,
    };
    climb(s, mover, ask, false)
}

/// The running vote did not pass: the climber stays. The turn passes when the options say so;
/// else the mover moves again (in strict games, not by another vote out of that room).
fn failed(s: &mut State) {
    s.log.push(LogEntry::Fail { p: s.turn });
    if let Some(v) = s.vote.take() {
        if s.options.fail_ends_turn {
            next_turn(s);
        } else if !s.tried.contains(&v.room) {
            s.tried.push(v.room);
        }
    }
}

/// `ones` 1-point tokens from the supply, while it lasts.
fn reward(s: &mut State, seat: Seat, ones: u8) {
    let ones = u8::try_from(u16::from(ones).min(s.supply)).unwrap_or(0);
    if ones == 0 {
        return;
    }
    s.supply -= u16::from(ones);
    if let Some(p) = s.players.get_mut(usize::from(seat)) {
        p.tokens.extend(std::iter::repeat_n(1, usize::from(ones)));
        p.tokens.sort_unstable();
    }
    s.log.push(LogEntry::Reward { p: seat, ones });
}

fn move_piece(rooms: &mut Rooms, from: u8, to: u8, who: Option<Seat>) -> Result<(), RuleError> {
    let here = rooms.get_mut(usize::from(from)).ok_or_else(damaged)?;
    let at = here.iter().position(|&x| x == who).ok_or_else(damaged)?;
    here.remove(at);
    rooms.get_mut(usize::from(to)).ok_or_else(damaged)?.push(who);
    Ok(())
}

/// The mover's climber goes up the path, taking its token unless the blocker covers it, with
/// whatever lent favours the climb asks for. A special coin's bonus is the mover's, this turn
/// only; in the hand it is a plain token.
fn climb(s: &mut State, seat: Seat, ask: Ask, free: bool) -> Result<(), RuleError> {
    let Ask { path, swap, carry } = ask;
    let lent = offered_in(s);
    let uses = climb_parts(&board(s, &lent), seat, ask)?;
    for &kind in &uses {
        spend(s, kind)?;
    }
    let p = s.layout.path(path).ok_or_else(damaged)?;
    move_piece(&mut s.rooms, p.from, p.to, Some(seat))?;
    if let Some(c) = carry {
        move_piece(&mut s.rooms, p.from, p.to, c.who())?;
    }
    let from = swap.or_else(|| {
        (s.layout.slot(path) && (path != s.blocker || uses.contains(&FavourKind::CoveredToken))).then_some(path)
    });
    let took = match from {
        Some(at) => {
            let slot = s.tokens_on.get_mut(usize::from(at)).ok_or_else(damaged)?;
            let took = slot.take();
            if took.is_some() {
                *slot = s.bag.pop();
            }
            took
        }
        None => None,
    };
    if let (Some(t), Some(player)) = (took, s.players.get_mut(usize::from(seat))) {
        player.tokens.push(t.value);
        player.tokens.sort_unstable();
    }
    s.log.push(LogEntry::Climb {
        p: seat,
        path,
        token: took.is_some(),
        took: took.map(|t| t.value),
        free,
    });
    if let Some(c) = carry {
        s.log.push(LogEntry::Carry {
            p: seat,
            who: c.who(),
            path,
        });
    }
    if let Some(kind) = took.and_then(|t| t.bonus) {
        let fired = match kind {
            Bonus::Block => {
                s.bonuses.block += 1;
                true
            }
            Bonus::Nudge => {
                s.bonuses.nudge += 1;
                true
            }
            // A used favour gets a use back; without favours it is a plain token.
            Bonus::Favour => {
                let on = s.options.favours;
                s.players.get_mut(usize::from(seat)).is_some_and(|p| {
                    let back = on && p.favour.is_some() && p.uses < USES;
                    if back {
                        p.uses += 1;
                    }
                    back
                })
            }
        };
        if fired {
            s.log.push(LogEntry::Bonus { p: seat, kind });
        }
    }
    arrive(s, p.to);
    end_move(s);
    Ok(())
}

/// After a move: a full top room ends the game; else the turn passes, unless extra moves are
/// left.
fn end_move(s: &mut State) {
    if held(&s.rooms, s.layout.summit) >= usize::from(s.layout.cap(s.layout.summit)) {
        finish(s, None);
    } else {
        s.moved = true;
        if !extras(s) {
            next_turn(s);
        }
    }
}

/// The turn passes, and with it what was lent and left over.
fn clear_turn(s: &mut State) {
    s.tried.clear();
    s.bonuses = Bonuses::default();
    s.moved = false;
    s.lent.clear();
    s.used.clear();
    s.asked.clear();
    s.withdrawn.clear();
}

fn next_turn(s: &mut State) {
    s.turn = (s.turn + 1) % s.n;
    clear_turn(s);
}

/// A player's points.
#[must_use]
pub fn score(p: &Player) -> u32 {
    p.tokens.iter().map(|&t| u32::from(t)).sum()
}

/// The game ends: with the top room full, the best scorer with a climber there wins (a tie goes
/// to the earlier arrival). Ended early by the admin (`by`), nobody wins.
fn finish(s: &mut State, by: Option<Seat>) {
    s.over = true;
    s.vote = None;
    clear_turn(s);
    s.pleas.clear();
    s.offers.clear();
    s.winners = if by.is_some() {
        Vec::new()
    } else {
        let top = s.rooms.get(usize::from(s.layout.summit)).cloned().unwrap_or_default();
        let arrived = |seat: Seat| top.iter().position(|&x| x == Some(seat)).unwrap_or(usize::MAX);
        let best = (0..s.n)
            .filter(|&seat| arrived(seat) != usize::MAX)
            .max_by_key(|&seat| {
                let points = s.players.get(usize::from(seat)).map_or(0, score);
                (points, std::cmp::Reverse(arrived(seat)))
            });
        best.into_iter().collect()
    };
    s.log.push(LogEntry::End {
        winners: s.winners.clone(),
        by,
    });
}

/// An absent player's move, made for them at random (from what their seat may see).
///
/// # Errors
/// When the seat owes no move.
pub fn apply_skip(prev: &State, seat: Seat) -> Result<State, RuleError> {
    if !pending(prev).contains(&seat) {
        return fail("That player does not owe a move");
    }
    let mut rng = StdRng::seed_from_u64((u64::from(prev.seed) << 32) | u64::from(prev.skips));
    // An absent owner says no to a request, an absent player to a deal; any other move is a
    // random one.
    let action = if prev.asked.contains(&seat) {
        Action::Decline
    } else if let Some((from, deal)) = deal_for(prev, seat) {
        Action::Refuse { from, deal }
    } else {
        choose_action(&view_for(prev, Some(seat)), &mut rng).ok_or_else(damaged)?
    };
    let mut s = prev.clone();
    s.skips = s.skips.wrapping_add(1);
    s.log.push(LogEntry::Skip { p: seat });
    apply_action(&s, seat, &action)
}

/// The admin ends the game now: nobody wins.
///
/// # Errors
/// When the game is already over.
pub fn end_early(prev: &State, by: Seat) -> Result<State, RuleError> {
    if prev.over {
        return fail("The game is over");
    }
    let mut s = prev.clone();
    finish(&mut s, Some(by));
    Ok(s)
}

/// The vote clock ran out: who has not answered says no. With enough yes the climb goes, the
/// needed yes taken in seat order after the mover unless the mover picked; else it fails.
///
/// # Errors
/// When no vote runs.
pub fn time_up(prev: &State) -> Result<State, RuleError> {
    let Some(vote) = &prev.vote else {
        return fail("No vote is running");
    };
    let mut s = prev.clone();
    for seat in voters_left(&s.rooms, vote, s.turn) {
        let of = count(&s.rooms, vote.room, Some(seat));
        if let Some(a) = s.vote.as_mut().and_then(|v| v.answers.get_mut(usize::from(seat))) {
            *a = Some(0);
        }
        s.log.push(LogEntry::Vote { p: seat, yes: 0, of });
    }
    if let Some(v) = s.vote.clone() {
        if enough(&v) {
            let take = first_yes(&v, s.turn);
            pass(&mut s, &v, &take)?;
        } else {
            failed(&mut s);
        }
    }
    Ok(s)
}

/// The vote clock: the line that asked, and the latest line since (an answer tops the clock up).
#[must_use]
pub fn clock(s: &State) -> Option<(usize, usize)> {
    let v = s.vote.as_ref()?;
    let start = usize::try_from(v.start).ok()?;
    Some((start, s.log.len().saturating_sub(1).max(start)))
}

/// Everyone moves to a new seat, `to[old] = new`, with their climbers, tokens and log lines.
///
/// # Errors
/// When `to` is not an order of the seats.
pub fn reseat(prev: &State, to: &[Seat]) -> Result<State, RuleError> {
    let mut sorted = to.to_vec();
    sorted.sort_unstable();
    if !sorted.iter().copied().eq(0..prev.n) {
        return fail("Not an order of the seats");
    }
    let m = |s: Seat| to.get(usize::from(s)).copied().unwrap_or(s);
    let mut s = prev.clone();
    for room in &mut s.rooms {
        for x in room.iter_mut().flatten() {
            *x = m(*x);
        }
    }
    s.players = game::permuted(&s.players, to);
    s.turn = m(s.turn);
    if let Some(v) = &mut s.vote {
        v.answers = game::permuted(&v.answers, to);
        if let Some(Carry::Seat { seat }) = &mut v.carry {
            *seat = m(*seat);
        }
    }
    s.lent = s.lent.iter().map(|&o| m(o)).collect();
    s.used = s.used.iter().map(|&o| m(o)).collect();
    s.asked = s.asked.iter().map(|&o| m(o)).collect();
    s.withdrawn = s.withdrawn.iter().map(|&o| m(o)).collect();
    for p in &mut s.pleas {
        (p.by, p.of) = (m(p.by), m(p.of));
    }
    for o in &mut s.offers {
        (o.by, o.to) = (m(o.by), m(o.to));
    }
    s.winners = s.winners.iter().map(|&w| m(w)).collect();
    for e in &mut s.log {
        match e {
            LogEntry::Start { first: p }
            | LogEntry::Enter { p, .. }
            | LogEntry::Climb { p, .. }
            | LogEntry::Ask { p, .. }
            | LogEntry::Vote { p, .. }
            | LogEntry::Bribe { p }
            | LogEntry::Reward { p, .. }
            | LogEntry::Fail { p }
            | LogEntry::Nudge { p, .. }
            | LogEntry::Block { p, .. }
            | LogEntry::Bonus { p, .. }
            | LogEntry::Done { p }
            | LogEntry::Decline { p }
            | LogEntry::Skip { p } => *p = m(*p),
            LogEntry::Favour { owner, user: p, .. } | LogEntry::Request { p, owner } => {
                *owner = m(*owner);
                *p = m(*p);
            }
            LogEntry::Carry { p, who, .. } => {
                *p = m(*p);
                *who = who.map(m);
            }
            LogEntry::Gift { from: p, to, .. }
            | LogEntry::Trade { from: p, to, .. }
            | LogEntry::Plea { p, of: to, .. }
            | LogEntry::Offer { p, to, .. }
            | LogEntry::Refuse { p, to, .. }
            | LogEntry::Recall { p, to, .. } => {
                *p = m(*p);
                *to = m(*to);
            }
            LogEntry::End { winners, by } => {
                *winners = winners.iter().map(|&w| m(w)).collect();
                *by = by.map(m);
            }
        }
    }
    Ok(s)
}
