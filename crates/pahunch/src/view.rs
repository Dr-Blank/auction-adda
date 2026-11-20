use crate::rules::pending;
use crate::types::{LogEntry, PlayerView, Seat, State, View};

const LOG_LIMIT: usize = 150;

/// The part of the state one seat may see. `seat` `None` = spectator. Points stay hidden: a
/// player sees their own tokens (and which token they took); everyone's show at the end.
#[must_use]
pub fn view_for(s: &State, seat: Option<Seat>) -> View {
    let mine = |i: Seat| seat == Some(i);
    let log_start = s.log.len().saturating_sub(LOG_LIMIT);
    let log = s
        .log
        .get(log_start..)
        .unwrap_or_default()
        .iter()
        .map(|e| match e {
            LogEntry::Climb {
                p, path, token, free, ..
            } if !s.over && !mine(*p) => LogEntry::Climb {
                p: *p,
                path: *path,
                token: *token,
                took: None,
                free: *free,
            },
            e => e.clone(),
        })
        .collect();
    View {
        n: s.n,
        you: seat,
        options: s.options,
        tried: s.tried.clone(),
        layout: s.layout.clone(),
        rooms: s.rooms.clone(),
        tokens_on: s.tokens_on.clone(),
        blocker: s.blocker,
        bag: u8::try_from(s.bag.len()).unwrap_or(u8::MAX),
        supply: s.supply,
        players: s
            .players
            .iter()
            .enumerate()
            .map(|(i, p)| PlayerView {
                hand: p.hand,
                tokens: (s.over || Seat::try_from(i).is_ok_and(mine)).then(|| p.tokens.clone()),
            })
            .collect(),
        turn: s.turn,
        vote: s.vote.clone(),
        pending: pending(s),
        log,
        log_start: u32::try_from(log_start).unwrap_or(u32::MAX),
        over: s.over,
        winners: s.winners.clone(),
    }
}
