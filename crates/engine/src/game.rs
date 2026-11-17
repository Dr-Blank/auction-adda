//! The rules. Every public function takes the state, checks the move and returns a new state, so a
//! rejected move never leaves a half-changed game.

use crate::config::config;
use crate::deck::{build_deck, index, rng, shuffle, sort_hand};
use crate::invariants::check_step;
use crate::types::{
    Action, Auction, AuctionKind, AuctionType, Card, GameState, LogEntry, Money, Player, RoundSummary, RuleError, Sale,
    Seat, SellType,
};

type Step = Result<(), RuleError>;

fn fail<T>(message: impl Into<String>) -> Result<T, RuleError> {
    Err(RuleError::new(message))
}

/// A state the engine never produces, such as a damaged save file.
fn damaged() -> RuleError {
    RuleError::new("The game state is damaged")
}

fn at<T>(items: &[T], i: impl Into<usize>) -> Result<&T, RuleError> {
    items.get(i.into()).ok_or_else(damaged)
}

fn at_mut<T>(items: &mut [T], i: impl Into<usize>) -> Result<&mut T, RuleError> {
    items.get_mut(i.into()).ok_or_else(damaged)
}

/// # Errors
/// When the number of players is not supported.
pub fn new_game(n: u8, seed: u32) -> Result<GameState, RuleError> {
    let cfg = config();
    let Some(players) = cfg.players.get(&n) else {
        return fail(format!("Cannot play with {n} players"));
    };
    let mut random = rng(seed);
    let deck = shuffle(build_deck(), &mut random);
    let turn = u8::try_from(index(random(), n.into())).map_err(|_| damaged())?;
    let mut s = GameState {
        n,
        players: (0..n)
            .map(|_| Player {
                hand: Vec::new(),
                money: players.start_money,
                bought: Vec::new(),
            })
            .collect(),
        deck,
        round: 0,
        turn,
        played: vec![0; cfg.suits.into()],
        tokens: vec![vec![0; cfg.suits.into()]; cfg.rounds.into()],
        auction: None,
        log: Vec::new(),
        summaries: Vec::new(),
        over: false,
        winners: Vec::new(),
        seed,
    };
    deal(&mut s)?;
    s.log.push(LogEntry::Round {
        round: 0,
        first: s.turn,
    });
    Ok(s)
}

fn deal(s: &mut GameState) -> Step {
    let cfg = config().players.get(&s.n).ok_or_else(damaged)?;
    let count = *at(&cfg.deal, s.round)?;
    for p in &mut s.players {
        for _ in 0..count {
            p.hand.extend(s.deck.pop());
        }
        sort_hand(&mut p.hand);
    }
    Ok(())
}

/// Seats that owe an action right now.
#[must_use]
pub fn pending(s: &GameState) -> Vec<Seat> {
    if s.over {
        return Vec::new();
    }
    let Some(a) = &s.auction else {
        return vec![s.turn];
    };
    let seats = 0..s.n;
    match a.kind {
        AuctionKind::Open => seats
            .filter(|&i| Some(i) != a.high_bidder && !a.done.get(usize::from(i)).is_some_and(|&d| d))
            .collect(),
        AuctionKind::Sealed => seats
            .filter(|&i| a.bids.get(usize::from(i)).is_some_and(Option::is_none))
            .collect(),
        AuctionKind::Fixed if a.price.is_none() => vec![a.auctioneer],
        _ => a.to_act.into_iter().collect(),
    }
}

/// Applies one move for a seat.
///
/// # Errors
/// When the move breaks the rules; the message says which.
pub fn apply_action(prev: &GameState, seat: Seat, action: &Action) -> Result<GameState, RuleError> {
    let mut s = prev.clone();
    check_seat(&s, seat)?;
    act(&mut s, seat, action)?;
    debug_assert_eq!(check_step(prev, &s), Ok(()));
    Ok(s)
}

/// Makes the neutral move for a seat that owes an action (used for absent players): pass, done,
/// sealed bid 0, decline. An auctioneer who owes a card plays nothing; one who owes a fixed price
/// takes the lot free.
///
/// # Errors
/// When the seat does not owe a move.
pub fn apply_skip(prev: &GameState, seat: Seat) -> Result<GameState, RuleError> {
    let mut s = prev.clone();
    check_seat(&s, seat)?;
    if !pending(&s).contains(&seat) {
        return fail("That player does not owe a move");
    }
    s.log.push(LogEntry::Skip { p: seat });
    match s.auction.as_ref().map(|a| (a.kind, a.high, a.price)) {
        None => match next_with_cards(&s, seat, false) {
            None => end_round(&mut s, seat)?,
            Some(next) => s.turn = next,
        },
        Some((AuctionKind::Open, high, _)) => act(&mut s, seat, &Action::Done { seen_high: high })?,
        Some((AuctionKind::Sealed, ..)) => act(&mut s, seat, &Action::Sealed { amount: 0 })?,
        Some((AuctionKind::Fixed, _, None)) => resolve(&mut s, None, 0, None)?,
        Some((AuctionKind::Offer, ..)) => act(&mut s, seat, &Action::Decline)?,
        Some(_) => act(&mut s, seat, &Action::Pass)?,
    }
    debug_assert_eq!(check_step(prev, &s), Ok(()));
    Ok(s)
}

/// Ends the running auction with a result called by the room admin, for tables that bid by voice.
/// `winner` `None` = no sale, the auctioneer takes the lot free. Payment follows the normal rules:
/// the winner pays the auctioneer, or the bank if the winner is the auctioneer. During a double
/// offer only "nobody adds" can be called: the second card would come from a hidden hand.
///
/// # Errors
/// When no auction is running, the seat does not exist or the buyer cannot pay.
pub fn apply_ruling(prev: &GameState, by: Seat, winner: Option<Seat>, price: Money) -> Result<GameState, RuleError> {
    let mut s = prev.clone();
    check_seat(&s, by)?;
    let Some(a) = &s.auction else {
        return fail("No auction is running");
    };
    if a.kind == AuctionKind::Offer && winner.is_some() {
        return fail("Nobody has added a second card yet; you can only call “nobody adds”");
    }
    if let Some(winner) = winner {
        if winner >= s.n {
            return fail("No such seat");
        }
        if price > at(&s.players, winner)?.money {
            return fail("Not possible at that price. Check the amount with the buyer");
        }
        resolve(&mut s, Some(winner), price, Some(by))?;
    } else {
        resolve(&mut s, None, 0, Some(by))?;
    }
    debug_assert_eq!(check_step(prev, &s), Ok(()));
    Ok(s)
}

/// The game is over: the richest win (ties share), and every player's money shows.
fn finish(s: &mut GameState, by: Option<Seat>) {
    let best = s.players.iter().map(|p| p.money).max().unwrap_or(0);
    s.winners = (0..s.n)
        .zip(&s.players)
        .filter(|(_, p)| p.money == best)
        .map(|(i, _)| i)
        .collect();
    s.over = true;
    s.log.push(LogEntry::End {
        winners: s.winners.clone(),
        by,
    });
}

/// The room admin ends the game before its last round: the running lot is called off and the
/// round is not scored, so the money as it stands decides.
///
/// # Errors
/// When the game is already over.
pub fn end_early(prev: &GameState, by: Seat) -> Result<GameState, RuleError> {
    if prev.over {
        return fail("The game is over");
    }
    let mut s = prev.clone();
    s.auction = None;
    finish(&mut s, Some(by));
    Ok(s)
}

/// Takes back a result the admin called: returns `before` (the state the ruling was applied to)
/// with an `undo` line added to the log. The caller checks that nothing else happened since.
///
/// # Errors
/// When `after` has no called result.
pub fn undo_ruling(before: &GameState, after: &GameState, by: Seat) -> Result<GameState, RuleError> {
    let cards = after
        .log
        .iter()
        .rev()
        .find_map(|e| match e {
            LogEntry::Sold { by: Some(_), cards, .. } | LogEntry::Free { by: Some(_), cards, .. } => Some(cards),
            _ => None,
        })
        .ok_or_else(|| RuleError::new("Nothing to undo"))?;
    let mut s = before.clone();
    s.log.push(LogEntry::Undo {
        by,
        cards: cards.clone(),
    });
    Ok(s)
}

fn check_seat(s: &GameState, seat: Seat) -> Step {
    if s.over {
        return fail("The game is over");
    }
    if seat >= s.n {
        return fail("No such seat");
    }
    Ok(())
}

fn find_card(hand: &[Card], id: u8) -> Result<Card, RuleError> {
    hand.iter()
        .find(|c| c.id == id)
        .copied()
        .ok_or_else(|| RuleError::new("That card is not in your hand"))
}

fn remove_card(hand: &mut Vec<Card>, card: Card) {
    if let Some(i) = hand.iter().position(|c| *c == card) {
        hand.remove(i);
    }
}

fn can_pair(double: Card, second: Card) -> bool {
    second.id != double.id && second.suit == double.suit && second.kind != AuctionType::Double
}

/// Counts one more card of `suit` as played; returns the new count.
fn count_played(s: &mut GameState, suit: u8) -> Result<u8, RuleError> {
    let count = at_mut(&mut s.played, suit)?;
    *count += 1;
    Ok(*count)
}

fn sell_type(card: Card) -> Result<SellType, RuleError> {
    card.kind.sell_type().ok_or_else(damaged)
}

#[expect(
    clippy::too_many_lines,
    reason = "one arm per move, in the order of the TypeScript original"
)]
fn act(s: &mut GameState, seat: Seat, action: &Action) -> Step {
    let limit = config().suit_limit;
    let money = at(&s.players, seat)?.money;
    match *action {
        Action::Play { card, second } => {
            if s.auction.is_some() {
                return fail("An auction is already running");
            }
            if s.turn != seat {
                return fail("It is not your turn");
            }
            let hand = &at(&s.players, seat)?.hand;
            let card = find_card(hand, card)?;
            let mut paired = None;
            if let Some(second) = second {
                if card.kind != AuctionType::Double {
                    return fail("Only a double card can take a second card");
                }
                let second = find_card(hand, second)?;
                if !can_pair(card, second) {
                    return fail("The second card must be the same suit and not a double");
                }
                paired = Some(second);
            }
            remove_card(&mut at_mut(&mut s.players, seat)?.hand, card);
            if count_played(s, card.suit)? >= limit {
                return shelve(s, seat, vec![card]);
            }
            if let Some(kind) = card.kind.sell_type() {
                return start_auction(s, seat, vec![card], kind);
            }
            if let Some(second) = paired {
                remove_card(&mut at_mut(&mut s.players, seat)?.hand, second);
                if count_played(s, card.suit)? >= limit {
                    return shelve(s, seat, vec![card, second]);
                }
                return start_auction(s, seat, vec![card, second], sell_type(second)?);
            }
            s.auction = Some(blank_auction(s.n, AuctionKind::Offer, seat, vec![card]));
            s.log.push(LogEntry::Offer {
                p: seat,
                cards: vec![card],
            });
            advance(s)
        }

        Action::Add { card } => {
            let Some(a) = s.auction.as_ref().filter(|a| a.kind == AuctionKind::Offer) else {
                return fail("No double card is waiting for a second card");
            };
            if a.to_act != Some(seat) {
                return fail("It is not your turn");
            }
            let double = *a.cards.first().ok_or_else(damaged)?;
            let card = find_card(&at(&s.players, seat)?.hand, card)?;
            if !can_pair(double, card) {
                return fail("The second card must be the same suit and not a double");
            }
            remove_card(&mut at_mut(&mut s.players, seat)?.hand, card);
            if count_played(s, card.suit)? >= limit {
                return shelve(s, seat, vec![double, card]);
            }
            start_auction(s, seat, vec![double, card], sell_type(card)?)
        }

        Action::Decline => {
            let Some(a) = s.auction.as_mut().filter(|a| a.kind == AuctionKind::Offer) else {
                return fail("No double card is waiting for a second card");
            };
            if a.to_act != Some(seat) {
                return fail("It is not your turn");
            }
            s.log.push(LogEntry::Decline { p: seat });
            a.step += 1;
            advance(s)
        }

        Action::Bid { amount, seen_high } => {
            let Some(a) = s.auction.as_mut() else {
                return fail("No auction is running");
            };
            match a.kind {
                AuctionKind::Open => {
                    if seen_high != Some(a.high) {
                        return fail("The high bid changed, look again");
                    }
                    if a.high_bidder == Some(seat) {
                        return fail("You already hold the high bid");
                    }
                }
                AuctionKind::Once => {
                    if a.to_act != Some(seat) {
                        return fail("It is not your turn");
                    }
                }
                _ => return fail("This auction does not take bids like that"),
            }
            if amount <= a.high {
                return fail(format!("Bid must be more than {}", a.high));
            }
            if amount > money {
                return fail("You do not have that much money");
            }
            a.high = amount;
            a.high_bidder = Some(seat);
            s.log.push(LogEntry::Bid { p: seat, amount });
            if a.kind == AuctionKind::Open {
                // Done stays done when others raise; bidding again is how a player comes back in.
                *at_mut(&mut a.done, seat)? = false;
                return settle_open(s);
            }
            a.step += 1;
            advance(s)
        }

        Action::Done { seen_high } => {
            let Some(a) = s.auction.as_mut().filter(|a| a.kind == AuctionKind::Open) else {
                return fail("No open auction is running");
            };
            if a.high_bidder == Some(seat) {
                return fail("You hold the high bid");
            }
            if seen_high != a.high {
                return fail("The high bid changed, look again");
            }
            *at_mut(&mut a.done, seat)? = true;
            settle_open(s)
        }

        Action::Pass => {
            let Some(a) = s
                .auction
                .as_mut()
                .filter(|a| matches!(a.kind, AuctionKind::Once | AuctionKind::Fixed))
            else {
                return fail("Nothing to pass on");
            };
            if a.kind == AuctionKind::Fixed && a.price.is_none() {
                return fail("The price is not set yet");
            }
            if a.to_act != Some(seat) {
                return fail("It is not your turn");
            }
            s.log.push(LogEntry::Pass { p: seat });
            a.step += 1;
            advance(s)
        }

        Action::Sealed { amount } => {
            let Some(a) = s.auction.as_mut().filter(|a| a.kind == AuctionKind::Sealed) else {
                return fail("No sealed auction is running");
            };
            let bid = at_mut(&mut a.bids, seat)?;
            if bid.is_some() {
                return fail("You already bid");
            }
            if amount > money {
                return fail("You do not have that much money");
            }
            *bid = Some(amount);
            settle_sealed(s)
        }

        Action::Price { amount } => {
            let Some(a) = s.auction.as_mut().filter(|a| a.kind == AuctionKind::Fixed) else {
                return fail("No fixed-price auction is running");
            };
            if a.auctioneer != seat {
                return fail("Only the auctioneer sets the price");
            }
            if a.price.is_some() {
                return fail("The price is already set");
            }
            if amount > money {
                return fail("The price cannot be more than your own money");
            }
            a.price = Some(amount);
            a.high = amount;
            s.log.push(LogEntry::Price { p: seat, amount });
            advance(s)
        }

        Action::Accept => {
            let Some((price, to_act)) = s
                .auction
                .as_ref()
                .filter(|a| a.kind == AuctionKind::Fixed)
                .and_then(|a| Some((a.price?, a.to_act)))
            else {
                return fail("Nothing to accept");
            };
            if to_act != Some(seat) {
                return fail("It is not your turn");
            }
            if price > money {
                return fail("You do not have that much money");
            }
            resolve(s, Some(seat), price, None)
        }

        Action::Unknown => fail("Unknown move"),
    }
}

fn blank_auction(n: u8, kind: AuctionKind, auctioneer: Seat, cards: Vec<Card>) -> Auction {
    Auction {
        kind,
        cards,
        auctioneer,
        high: 0,
        high_bidder: None,
        done: vec![false; n.into()],
        step: 0,
        to_act: None,
        bids: vec![None; n.into()],
        price: None,
    }
}

fn start_auction(s: &mut GameState, auctioneer: Seat, cards: Vec<Card>, kind: SellType) -> Step {
    s.auction = Some(blank_auction(s.n, kind.into(), auctioneer, cards.clone()));
    s.log.push(LogEntry::Play {
        p: auctioneer,
        cards,
        kind,
    });
    match kind {
        SellType::Open => settle_open(s),
        SellType::Once => advance(s),
        SellType::Sealed => settle_sealed(s),
        // Wait for the auctioneer's price.
        SellType::Fixed => Ok(()),
    }
}

// Nothing below ever acts for a player because of their money or their hand: an automatic pass
// would tell the table what that player cannot afford or does not hold.

/// Open auction: closes when everyone but the leader has said they are done.
fn settle_open(s: &mut GameState) -> Step {
    let a = s.auction.as_ref().ok_or_else(damaged)?;
    let closed = (0..s.n).all(|i| Some(i) == a.high_bidder || a.done.get(usize::from(i)).is_some_and(|&d| d));
    if closed {
        let (winner, high) = (a.high_bidder, a.high);
        return resolve(s, winner, high, None);
    }
    Ok(())
}

fn settle_sealed(s: &mut GameState) -> Step {
    let a = s.auction.as_ref().ok_or_else(damaged)?;
    let Some(bids) = a.bids.iter().copied().collect::<Option<Vec<Money>>>() else {
        return Ok(());
    };
    let auctioneer = a.auctioneer;
    s.log.push(LogEntry::Sealed { bids: bids.clone() });
    let best = bids.iter().copied().max().unwrap_or(0);
    if best == 0 {
        return resolve(s, None, 0, None);
    }
    // Ties: the auctioneer first, then clockwise from the auctioneer.
    for k in 0..s.n {
        let seat = (auctioneer + k) % s.n;
        if bids.get(usize::from(seat)) == Some(&best) {
            return resolve(s, Some(seat), best, None);
        }
    }
    Ok(())
}

/// Once-around, fixed-price and offer: hand the turn to the next seat, or finish when it comes back
/// to the auctioneer.
fn advance(s: &mut GameState) -> Step {
    let n = s.n;
    let a = s.auction.as_mut().ok_or_else(damaged)?;
    if a.step >= n {
        let (winner, high) = (a.high_bidder, a.high);
        return resolve(s, winner, high, None);
    }
    let seat = (a.auctioneer + 1 + a.step) % n;
    if seat == a.auctioneer {
        // Once-around: with no bids the auctioneer takes the lot free; otherwise they get the last bid.
        match a.kind {
            AuctionKind::Once if a.high_bidder.is_none() => return resolve(s, None, 0, None),
            AuctionKind::Fixed => {
                let price = a.price.ok_or_else(damaged)?;
                return resolve(s, Some(seat), price, None);
            }
            AuctionKind::Offer => return resolve(s, None, 0, None),
            _ => {}
        }
    }
    a.to_act = Some(seat);
    Ok(())
}

/// Ends the auction. `winner` `None` = nobody bid, the auctioneer takes the lot free.
fn resolve(s: &mut GameState, winner: Option<Seat>, price: Money, by: Option<Seat>) -> Step {
    let a = s.auction.take().ok_or_else(damaged)?;
    let auctioneer = a.auctioneer;
    if let Some(winner) = winner {
        let buyer = at_mut(&mut s.players, winner)?;
        buyer.money = buyer.money.checked_sub(price).ok_or_else(damaged)?;
        buyer.bought.extend(&a.cards);
        if winner != auctioneer {
            let seller = at_mut(&mut s.players, auctioneer)?;
            seller.money = seller.money.checked_add(price).ok_or_else(damaged)?;
        }
        s.log.push(LogEntry::Sold {
            to: winner,
            from: auctioneer,
            price,
            cards: a.cards,
            by,
        });
    } else {
        at_mut(&mut s.players, auctioneer)?.bought.extend(&a.cards);
        s.log.push(LogEntry::Free {
            p: auctioneer,
            cards: a.cards,
            by,
        });
    }
    match next_with_cards(s, auctioneer, true) {
        None => end_round(s, auctioneer),
        Some(next) => {
            s.turn = next;
            Ok(())
        }
    }
}

/// First seat clockwise after `from` that still holds cards.
fn next_with_cards(s: &GameState, from: Seat, include_from: bool) -> Option<Seat> {
    let last = if include_from { s.n } else { s.n - 1 };
    (1..=last)
        .map(|k| (from + k) % s.n)
        .find(|&seat| s.players.get(usize::from(seat)).is_some_and(|p| !p.hand.is_empty()))
}

/// The card (or double lot) that brought a suit to the limit is not sold, and the round ends.
fn shelve(s: &mut GameState, seat: Seat, cards: Vec<Card>) -> Step {
    let suit = at(&cards, 0_usize)?.suit;
    s.log.push(LogEntry::Shelved { p: seat, cards, suit });
    end_round(s, seat)
}

/// Lots bought since the round started, from the log. An undone call is not in it: undo restores
/// the state before the call.
fn round_sales(s: &GameState, round: u8) -> Vec<Sale> {
    let start = s
        .log
        .iter()
        .rposition(|e| matches!(e, LogEntry::Round { round: r, .. } if *r == round))
        .map_or(0, |i| i + 1);
    s.log
        .get(start..)
        .unwrap_or_default()
        .iter()
        .filter_map(|e| match e {
            LogEntry::Sold {
                to, from, price, cards, ..
            } => Some(Sale {
                to: *to,
                from: *from,
                price: *price,
                cards: cards.clone(),
            }),
            LogEntry::Free { p, cards, .. } => Some(Sale {
                to: *p,
                from: *p,
                price: 0,
                cards: cards.clone(),
            }),
            _ => None,
        })
        .collect()
}

fn end_round(s: &mut GameState, ender: Seat) -> Step {
    let cfg = config();
    let round = s.round;
    let counts = s.played.clone();
    let mut order: Vec<(u8, u8)> = (0..cfg.suits)
        .zip(&counts)
        .filter(|&(_, &count)| count > 0)
        .map(|(suit, &count)| (suit, count))
        .collect();
    order.sort_by(|x, y| y.1.cmp(&x.1).then(x.0.cmp(&y.0)));
    let ranked: Vec<u8> = order.iter().take(cfg.tokens.len()).map(|x| x.0).collect();
    let row = at_mut(&mut s.tokens, round)?;
    for (&suit, &tokens) in ranked.iter().zip(&cfg.tokens) {
        *at_mut(row, suit)? = tokens;
    }
    let values: Vec<Money> = (0..cfg.suits)
        .map(|suit| {
            if ranked.contains(&suit) {
                s.tokens
                    .iter()
                    .take(usize::from(round) + 1)
                    .map(|row| row.get(usize::from(suit)).copied().unwrap_or(0))
                    .sum()
            } else {
                0
            }
        })
        .collect();
    let sold: Vec<Vec<Card>> = s.players.iter().map(|p| p.bought.clone()).collect();
    let payouts: Vec<Money> = sold
        .iter()
        .map(|cards| {
            cards
                .iter()
                .map(|c| values.get(usize::from(c.suit)).copied().unwrap_or(0))
                .sum()
        })
        .collect();
    for (p, &payout) in s.players.iter_mut().zip(&payouts) {
        p.money = p.money.checked_add(payout).ok_or_else(damaged)?;
        p.bought.clear();
    }
    let sales = round_sales(s, round);
    s.summaries.push(RoundSummary {
        round,
        counts,
        ranked,
        values,
        sold,
        payouts,
        sales: Some(sales),
    });
    s.log.push(LogEntry::Score { round });
    s.auction = None;
    s.played = vec![0; cfg.suits.into()];
    s.round += 1;

    if s.round >= cfg.rounds {
        finish(s, None);
        return Ok(());
    }
    deal(s)?;
    let Some(first) = next_with_cards(s, ender, true) else {
        return end_round(s, ender);
    };
    s.turn = first;
    s.log.push(LogEntry::Round { round: s.round, first });
    Ok(())
}
