import type { PahunchOptions } from "../../generated/index.ts";
import type { PahunchSkin } from "./skin.ts";

/**
 * The rules in this skin's words: short, in the order a first game needs them. `options`: the
 * running game's house rules; without them (the lobby) both ways are told.
 */
export function Rules({ skin, n, options }: { skin: PahunchSkin; n?: number; options?: PahunchOptions }) {
  const { climber, climbers, points, neutral, neutrals, blocker, bribe } = skin.nouns;
  const top = skin.rooms.full?.at(-1)?.name ?? "the top room";
  return (
    <section className="rules">
      <h2>How to play</h2>
      <p>{skin.story}</p>
      <h3>Your turn: one move</h3>
      <ul>
        <li>
          <b>Add</b> a {climber} from your hand to a bottom room with a free seat.
        </li>
        <li>
          <b>Move up</b> one of your {climbers}, along a path to the room above, if it has a free seat. Leaving a room
          takes yes votes from more than half its seats (2 of 3, 3 of 5, 4 of 7; a room of one is free).
        </li>
        <li>
          <b>Nudge</b> an {neutral} up a path, no vote needed, and take 1 {points}. {neutrals} never reach the {top}.
        </li>
        <li>
          <b>Send the {blocker}</b> to another path.
        </li>
      </ul>
      <h3>Votes</h3>
      <ul>
        <li>Your own {climbers} in the room say yes. Each other player answers for theirs: yes with some, or no.</li>
        <li>Each yes the climb needed earns the player who gave it 1 {points}.</li>
        <li>
          An {neutral} says yes only for {bribe}: you pay one of your tokens worth 2 or more, and it leaves the game.
        </li>
        <li>
          The path with the {blocker} on it needs no vote at all, but whoever goes that way takes nothing from it.
        </li>
        <li>
          If the vote fails, or you give up, your {climber} stays.{" "}
          {options === undefined
            ? "Then you choose another move, but not another vote out of that room; with the house rule “A failed vote ends the turn”, your turn ends instead."
            : options.failEndsTurn
              ? "Your turn ends."
              : "Choose another move, but not another vote out of that room."}
        </li>
      </ul>
      <h3>{points}</h3>
      <ul>
        <li>
          Moving up out of a room of 3 or more takes the token lying on the path; a new one is drawn for it. Only you
          see your {points} until the game ends.
        </li>
        <li>Give tokens to anyone, at any time. Deals are made on the call and nothing makes anyone keep them.</li>
      </ul>
      {options?.favours !== false && (
        <>
          <h3>Favours</h3>
          <ul>
            <li>
              Each player gets one favour, different for everyone, with two uses. Favours are public: each player’s
              shows on their seat.
            </li>
            <li>
              A favour helps only someone else’s move. On another player’s turn you may offer yours to them; deals for
              it are made on the call. Each use earns you {points} and costs a use. An offer that is not used costs
              nothing.
            </li>
            {Object.values(skin.favours).map((f) => (
              <li key={f.name}>
                <b>
                  {f.glyph} {f.name}:
                </b>{" "}
                {f.effect}
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>The end</h3>
      <p>
        The game ends the moment the {top} is full. Only players with a {climber} there can win: the most {points} wins,
        and a tie goes to whoever got there first. If the admin ends the game early, nobody wins.
      </p>
      {n !== undefined && <p className="muted small">This table: {n} players.</p>}
    </section>
  );
}
