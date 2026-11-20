//! Pahunch keeps every rule the server relies on, on every board and seat count.

#[test]
fn random_games_keep_the_rules() {
    assert_eq!(game::check::random_games::<pahunch::Pahunch>(12), Ok(()));
}
