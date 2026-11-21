use crate::rules::pending;
use crate::types::{LogEntry, Offer, PlayerView, Seat, State, View};

const LOG_LIMIT: usize = 150;

/// The part of the state one seat may see. `seat` `None` = spectator. Points stay hidden: a
/// player sees their own tokens (and which token they took); everyone's show at the end. Favour
/// uses left are hidden the same way unless the room shows them.
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
        bonuses: s.bonuses,
        moved: s.moved,
        lent: s.lent.clone(),
        used: s.used.clone(),
        asked: s.asked.clone(),
        withdrawn: s.withdrawn.clone(),
        pleas: s.pleas.clone(),
        offers: s
            .offers
            .iter()
            .map(|o| {
                let party = mine(o.by) || mine(o.to);
                let hide = |ts: &[u8]| if party { ts.to_vec() } else { vec![0; ts.len()] };
                Offer {
                    by: o.by,
                    to: o.to,
                    give: hide(&o.give),
                    want: hide(&o.want),
                }
            })
            .collect(),
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
            .map(|(i, p)| {
                let own = Seat::try_from(i).is_ok_and(mine);
                PlayerView {
                    hand: p.hand,
                    tokens: (s.over || own).then(|| p.tokens.clone()),
                    favour: p.favour,
                    uses: (s.over || own || s.options.favour_uses_open).then_some(p.uses),
                }
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
