//! Auction Adda rules. No I/O, no async, no clock: the server owns all of that. [`Auction`] is
//! the game as the server hosts it (the [`game::Game`] trait).

mod auction;
mod bot;
mod config;
mod deck;
mod invariants;
mod rules;
mod types;
mod view;

pub use auction::Auction;
pub use bot::choose_action;
pub use config::{Config, PlayerConfig, config};
pub use deck::{build_deck, sort_hand};
pub use game::{permuted, rng, shuffle};
pub use invariants::check_step;
pub use rules::{apply_action, apply_ruling, apply_skip, end_early, new_game, pending, reseat, undo_ruling};
pub use types::*;
pub use view::view_for;
