//! Game constants, read from `config.json`. The client imports the same file.

use std::collections::BTreeMap;
use std::sync::LazyLock;

use serde::Deserialize;

use crate::types::{AuctionType, Money};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub suits: u8,
    pub rounds: u8,
    /// A round ends when this many cards of one suit have been played.
    pub suit_limit: u8,
    /// Tokens for the first, second and third suit of a round.
    pub tokens: Vec<Money>,
    /// Everything that depends on the number of players. Add a row to support a new count.
    pub players: BTreeMap<u8, PlayerConfig>,
    /// `card_table[suit]` = how many cards of each auction type that suit has.
    pub card_table: Vec<BTreeMap<AuctionType, u8>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerConfig {
    /// Cards dealt to each player at the start of each round.
    pub deal: Vec<u8>,
    pub start_money: Money,
}

impl Config {
    #[must_use]
    pub fn min_players(&self) -> u8 {
        self.players.keys().next().copied().unwrap_or(0)
    }

    #[must_use]
    pub fn max_players(&self) -> u8 {
        self.players.keys().next_back().copied().unwrap_or(0)
    }
}

static CONFIG: LazyLock<Config> = LazyLock::new(|| {
    #[expect(clippy::expect_used, reason = "the file is compiled in; the config test parses it")]
    serde_json::from_str(include_str!("../config.json")).expect("config.json is valid")
});

#[must_use]
pub fn config() -> &'static Config {
    &CONFIG
}
