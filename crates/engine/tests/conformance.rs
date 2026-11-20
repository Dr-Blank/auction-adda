//! What every game on the table must keep true (`game::check`), for Auction Adda.

#[test]
fn plays_random_games_by_the_rules_every_game_keeps() {
    assert_eq!(game::check::random_games::<engine::Auction>(12), Ok(()));
}
