//! The rules. Every function takes a state and returns a new one, so a refused move changes
//! nothing.
//!
//! A turn is one move: put a climber into a bottom room, climb one of yours a room up, nudge a
//! neutral up, or move the blocker. Leaving a room takes more than half its seats in yes votes:
//! your own climbers there say yes, every other player answers for theirs, and a neutral says
//! yes when the mover pays it a token. A climb by the blocker's path needs no vote but takes no
//! token. Back paths are locked. A special coin taken on a climb gives a bonus: one more move
//! after the main one, before the turn passes. The game ends when the top room is full (neutrals count): of the
//! players with a climber there, the one with the most points wins (a tie goes to whoever arrived
//! first); with none there, nobody wins.

use rand::SeedableRng;
use rand::rngs::StdRng;

use crate::board::{Layout, Rooms, boards};
use crate::bot::choose_action;
use crate::types::{Action, Bonus, Bonuses, LogEntry, Options, Player, RuleError, Seat, State, Vote};
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
    let Some(seating) = board.players.get(&n) else {
        return fail(format!("Cannot play with {n} players"));
    };
    let layout = board.layout(seating);
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
    Ok(State {
        n,
        seed,
        options,
        tried: Vec::new(),
        bonuses: Bonuses::default(),
        layout,
        rooms,
        tokens_on,
        blocker: board.blocker,
        bag,
        supply: board.supply.saturating_sub(u16::from(n) * u16::from(board.start_ones)),
        players: (0..n)
            .map(|_| Player {
                hand: seating.climbers,
                tokens: vec![1; usize::from(board.start_ones)],
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

fn has_space(layout: &Layout, rooms: &Rooms, room: u8) -> bool {
    held(rooms, room) < usize::from(layout.cap(room))
}

/// Tokens the mover could pay a neutral with.
fn bribe_tokens(layout: &Layout, tokens: &[u8]) -> usize {
    tokens.iter().filter(|&&t| t >= layout.min_bribe).count()
}

/// How a climb goes, if it may start.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Climb {
    /// The blocker is on the path: no vote, no token.
    Blocked,
    /// Enough of the mover's own climbers are there.
    Own,
    /// A vote decides.
    Ask { need: u8, own: u8 },
}

pub(crate) fn check_enter(layout: &Layout, rooms: &Rooms, hand: u8, room: u8) -> Result<(), RuleError> {
    if hand == 0 {
        return fail("All your climbers are on the board");
    }
    if !layout.entry(room) {
        return fail("New climbers go into a bottom room");
    }
    if !has_space(layout, rooms, room) {
        return fail("That room is full");
    }
    Ok(())
}

/// Where a climb starts from: the board, and what this turn has already tried.
pub(crate) struct Board<'a> {
    pub layout: &'a Layout,
    pub rooms: &'a Rooms,
    pub blocker: u8,
    pub tried: &'a [u8],
}

pub(crate) fn check_climb(b: &Board<'_>, seat: Seat, tokens: &[u8], path: u8) -> Result<Climb, RuleError> {
    let Board {
        layout,
        rooms,
        blocker,
        tried,
    } = *b;
    let Some(p) = layout.path(path) else {
        return fail("No such path");
    };
    if p.back {
        return fail(LOCKED);
    }
    let own = count(rooms, p.from, Some(seat));
    if own == 0 {
        return fail("You have no climber at the foot of that path");
    }
    if !has_space(layout, rooms, p.to) {
        return fail("The room above is full");
    }
    if path == blocker {
        return Ok(Climb::Blocked);
    }
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

pub(crate) fn check_nudge(layout: &Layout, rooms: &Rooms, path: u8) -> Result<(), RuleError> {
    let Some(p) = layout.path(path) else {
        return fail("No such path");
    };
    if p.back {
        return fail(LOCKED);
    }
    if count(rooms, p.from, None) == 0 {
        return fail("No neutral at the foot of that path");
    }
    if !has_space(layout, rooms, p.to) {
        return fail("The room above is full");
    }
    Ok(())
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

#[must_use]
pub fn pending(s: &State) -> Vec<Seat> {
    if s.over {
        return Vec::new();
    }
    match &s.vote {
        None => vec![s.turn],
        Some(v) => {
            let left = voters_left(&s.rooms, v, s.turn);
            if left.is_empty() { vec![s.turn] } else { left }
        }
    }
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
    if let Action::Give { to, tokens } = action {
        give(&mut s, seat, *to, tokens)?;
        return Ok(s);
    }
    if s.vote.is_some() {
        match *action {
            Action::Vote { yes } => answer(&mut s, seat, yes)?,
            Action::Bribe { token } => bribe(&mut s, seat, token)?,
            Action::Withdraw => {
                if seat != s.turn {
                    return fail("Only the climber can give up the climb");
                }
                failed(&mut s);
            }
            Action::Unknown => return fail("Unknown move"),
            _ => return fail("Wait for the vote to finish"),
        }
        return Ok(s);
    }
    if seat != s.turn {
        return fail("It is not your turn");
    }
    if s.bonuses.any() {
        bonus_move(&mut s, seat, action)?;
        return Ok(s);
    }
    let me = usize::from(seat);
    match *action {
        Action::Enter { room } => {
            let hand = s.players.get(me).ok_or_else(damaged)?.hand;
            check_enter(&s.layout, &s.rooms, hand, room)?;
            s.rooms.get_mut(usize::from(room)).ok_or_else(damaged)?.push(Some(seat));
            if let Some(p) = s.players.get_mut(me) {
                p.hand -= 1;
            }
            s.log.push(LogEntry::Enter { p: seat, room });
            end_move(&mut s);
        }
        Action::Climb { path } => {
            let tokens = &s.players.get(me).ok_or_else(damaged)?.tokens;
            let board = Board {
                layout: &s.layout,
                rooms: &s.rooms,
                blocker: s.blocker,
                tried: &s.tried,
            };
            match check_climb(&board, seat, tokens, path)? {
                Climb::Blocked | Climb::Own => climb(&mut s, seat, path, true)?,
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
            end_move(&mut s);
        }
        Action::Done => return fail("Make your move first"),
        Action::Vote { .. } | Action::Bribe { .. } | Action::Withdraw => return fail("No vote is running"),
        Action::Unknown => return fail("Unknown move"),
        Action::Give { .. } => {}
    }
    Ok(s)
}

fn nudge(s: &mut State, seat: Seat, path: u8) -> Result<(), RuleError> {
    check_nudge(&s.layout, &s.rooms, path)?;
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

/// A move after the main one: a bonus, or the end of the turn.
fn bonus_move(s: &mut State, seat: Seat, action: &Action) -> Result<(), RuleError> {
    match *action {
        Action::Block { path } if s.bonuses.block > 0 => {
            block(s, seat, path)?;
            s.bonuses.block -= 1;
        }
        Action::Nudge { path } if s.bonuses.nudge > 0 => {
            nudge(s, seat, path)?;
            s.bonuses.nudge -= 1;
        }
        Action::Done => {
            s.log.push(LogEntry::Done { p: seat });
            s.bonuses = Bonuses::default();
        }
        Action::Unknown => return fail("Unknown move"),
        _ => return fail("Use a bonus move or end the turn"),
    }
    end_move(s);
    Ok(())
}

fn give(s: &mut State, from: Seat, to: Seat, tokens: &[u8]) -> Result<(), RuleError> {
    if to == from || to >= s.n {
        return fail("Give to another player");
    }
    if tokens.is_empty() {
        return fail("Pick the tokens to give");
    }
    let mut left = s.players.get(usize::from(from)).ok_or_else(damaged)?.tokens.clone();
    for t in tokens {
        let Some(at) = left.iter().position(|x| x == t) else {
            return fail("You do not have those tokens");
        };
        left.swap_remove(at);
    }
    left.sort_unstable();
    if let Some(p) = s.players.get_mut(usize::from(from)) {
        p.tokens = left;
    }
    if let Some(p) = s.players.get_mut(usize::from(to)) {
        p.tokens.extend_from_slice(tokens);
        p.tokens.sort_unstable();
    }
    s.log.push(LogEntry::Gift {
        from,
        to,
        count: u8::try_from(tokens.len()).unwrap_or(u8::MAX),
    });
    // The mover may have given away the token a bribe needed.
    settle(s, None)
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
    settle(s, Some(seat))
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
    settle(s, None)
}

/// After a change to the running vote: it passes once enough yes are in, and fails once nothing
/// can bring them in. `last` answered just now: of its yes, only the needed ones earn a token.
fn settle(s: &mut State, last: Option<Seat>) -> Result<(), RuleError> {
    let Some(vote) = s.vote.clone() else { return Ok(()) };
    let mover = s.turn;
    let yes = vote.yes();
    if yes >= vote.need {
        let excess = yes - vote.need;
        for (i, a) in vote.answers.iter().enumerate() {
            let Ok(seat) = Seat::try_from(i) else { continue };
            let given = a.unwrap_or(0);
            let earned = if Some(seat) == last {
                given.saturating_sub(excess)
            } else {
                given
            };
            if seat != mover && earned > 0 {
                reward(s, seat, earned);
            }
        }
        s.vote = None;
        return climb(s, mover, vote.path, false);
    }
    let tokens = &s.players.get(usize::from(mover)).ok_or_else(damaged)?.tokens;
    if voters_left(&s.rooms, &vote, mover).is_empty() && !can_bribe(&s.layout, &s.rooms, &vote, tokens) {
        failed(s);
    }
    Ok(())
}

/// The running vote did not pass: the climber stays. The turn passes when the options say so;
/// else the mover moves again, but not by another vote out of that room.
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

/// The mover's climber goes up `path`, taking its token unless the blocker covers it. A special
/// coin's bonus is the mover's, this turn only; in the hand it is a plain token.
fn climb(s: &mut State, seat: Seat, path: u8, free: bool) -> Result<(), RuleError> {
    let p = s.layout.path(path).ok_or_else(damaged)?;
    move_piece(&mut s.rooms, p.from, p.to, Some(seat))?;
    let took = if s.layout.slot(path) && path != s.blocker {
        let slot = s.tokens_on.get_mut(usize::from(path)).ok_or_else(damaged)?;
        let took = slot.take();
        if took.is_some() {
            *slot = s.bag.pop();
        }
        took
    } else {
        None
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
            // Gives a used favour one use back; without favours it is a plain token.
            Bonus::Favour => false,
        };
        if fired {
            s.log.push(LogEntry::Bonus { p: seat, kind });
        }
    }
    end_move(s);
    Ok(())
}

/// After a move: a full top room ends the game; else the turn passes, unless bonus moves are
/// left.
fn end_move(s: &mut State) {
    if held(&s.rooms, s.layout.summit) >= usize::from(s.layout.cap(s.layout.summit)) {
        finish(s, None);
    } else if !s.bonuses.any() {
        next_turn(s);
    }
}

fn next_turn(s: &mut State) {
    s.turn = (s.turn + 1) % s.n;
    s.tried.clear();
    s.bonuses = Bonuses::default();
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
    s.bonuses = Bonuses::default();
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
    let action = choose_action(&view_for(prev, Some(seat)), &mut rng).ok_or_else(damaged)?;
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

/// The vote clock ran out: who has not answered says no, and the climb fails unless the yes
/// are in.
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
    if s.vote.is_some() {
        failed(&mut s);
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
            | LogEntry::Skip { p } => *p = m(*p),
            LogEntry::Gift { from, to, .. } => {
                *from = m(*from);
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
