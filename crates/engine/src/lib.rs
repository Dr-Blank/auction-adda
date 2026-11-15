//! Auction Adda rules. No I/O, no async, no clock: the server owns all of that.

mod config;
mod deck;
mod game;
mod invariants;
mod types;
mod view;

pub use config::{Config, PlayerConfig, config};
pub use deck::{build_deck, rng, shuffle, sort_hand};
pub use game::{apply_action, apply_ruling, apply_skip, new_game, pending, undo_ruling};
pub use invariants::check_step;
pub use types::*;
pub use view::view_for;
