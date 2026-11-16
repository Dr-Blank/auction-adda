//! Bot seats the server plays itself. A bot sees only its own seat's view, like any player, and
//! makes random legal moves; it is a stand-in for a missing player, not an opponent worth beating.
//! Same choices as `scripts/bot.ts`, which drives the bots that connect over the socket.

use engine::{Action, AuctionKind, AuctionType, Card, View};
use rand::seq::IndexedRandom;
use rand::{Rng, RngExt};

/// The move for the viewer of `v`, or `None` when it owes none.
pub fn choose_action<R: Rng + ?Sized>(v: &View, rng: &mut R) -> Option<Action> {
    let me = v.you?;
    if !v.pending.contains(&me) {
        return None;
    }
    let money = v.players.get(usize::from(me))?.money.unwrap_or(0);
    let seconds = |suit: u8| -> Vec<&Card> {
        v.hand
            .iter()
            .filter(|c| c.suit == suit && c.kind != AuctionType::Double)
            .collect()
    };

    let Some(a) = &v.auction else {
        let card = v.hand.choose(rng)?;
        if card.kind == AuctionType::Double
            && rng.random_bool(0.6)
            && let Some(second) = seconds(card.suit).choose(rng)
        {
            return Some(Action::Play {
                card: card.id,
                second: Some(second.id),
            });
        }
        return Some(Action::Play {
            card: card.id,
            second: None,
        });
    };

    Some(match a.kind {
        AuctionKind::Open => {
            let raise = a.high + 1 + rng.random_range(0..=4);
            if raise <= money && a.high < 40 && rng.random_bool(0.4) {
                Action::Bid {
                    amount: raise,
                    seen_high: Some(a.high),
                }
            } else {
                Action::Done { seen_high: a.high }
            }
        }
        AuctionKind::Once => {
            let raise = a.high + 1 + rng.random_range(0..=6);
            if raise <= money && rng.random_bool(0.5) {
                Action::Bid {
                    amount: raise,
                    seen_high: None,
                }
            } else {
                Action::Pass
            }
        }
        AuctionKind::Sealed => Action::Sealed {
            amount: rng.random_range(0..=money.min(30)),
        },
        AuctionKind::Fixed => match a.price {
            None => Action::Price {
                amount: rng.random_range(0..=money.min(30)),
            },
            Some(price) if price <= money && rng.random_bool(0.4) => Action::Accept,
            Some(_) => Action::Pass,
        },
        AuctionKind::Offer => {
            let suit = a.cards.first()?.suit;
            match seconds(suit).choose(rng) {
                Some(card) if rng.random_bool(0.5) => Action::Add { card: card.id },
                _ => Action::Decline,
            }
        }
    })
}
