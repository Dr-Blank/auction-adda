import type { PahunchOptions } from "../../generated/index.ts";
import type { PahunchSkin } from "./skin.ts";

const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The rules in this skin's words: short, in the order a first game needs them. `options`: the
 * running game's house rules; without them (the lobby) both ways are told.
 */
export function Rules({ skin, n, options }: { skin: PahunchSkin; n?: number; options?: PahunchOptions }) {
  const { climber, climbers, points, neutral, neutrals, blocker, bribe, path, backPath } = skin.nouns;
  const top = skin.rooms.full?.at(-1)?.name ?? "the top room";
  const favoursOn = options?.favours !== false;
  const key = skin.favours.backStairs;
  return (
    <section className="rules">
      <h2>How to play</h2>
      <p>{skin.story}</p>

      <details open>
        <summary>Your turn: one move</summary>
        <p>Tap something glowing on the board, then pick the move in the bar. Anything you tap explains itself.</p>
        <ul>
          <li>
            <b>Add</b> a {climber} from your hand to a bottom room with a free seat.
          </li>
          <li>
            <b>Move up</b> one of your {climbers} along a {path} to the room above, if it has a free seat.
          </li>
          <li>
            <b>Nudge</b> an {neutral} up a {path}: no vote, and you take 1 {points}.
          </li>
          <li>
            <b>Send {blocker}</b> to another {path} that has {points} on it.
          </li>
        </ul>
      </details>

      <details>
        <summary>Votes</summary>
        <ul>
          <li>
            Leaving a room takes yes votes from more than half its seats: 2 of 3, 3 of 5, 4 of 7. Leaving a post of one
            is free.
          </li>
          <li>
            Your own {climbers} in the room say yes. Every other player answers for theirs: yes with some of them, or
            no.
          </li>
          <li>
            Each yes the climb needed earns the player who gave it 1 {points}. Once enough yes are in, you take the ones
            you need and go, without waiting for the rest; with more yes than needed, you pick whose earn the {points}.
          </li>
          <li>
            An {neutral} says yes only for {bribe}: one of your tokens worth 2 or more, and it leaves the game. Two 1s
            will not do, and there is no change.
          </li>
          <li>
            If the vote fails, or you give up, your {climber} stays.{" "}
            {options === undefined
              ? "You then pick another move, or ask again. House rules can make it stricter: “A failed vote ends the turn”, or “one vote per room per turn”."
              : options.failEndsTurn
                ? "Your turn ends (house rule)."
                : options.oneVotePerRoom
                  ? "Pick another move, but not a second vote out of that room (house rule)."
                  : "Pick another move, or ask the same room again."}{" "}
            Anything paid to an {neutral} stays paid.
          </li>
        </ul>
      </details>

      <details>
        <summary>
          {upper(points)} and {blocker}
        </summary>
        <ul>
          <li>
            Moving up out of a room of 3 or more takes the {points} lying on that {path}; a new coin is drawn for it.
            Only you see your {points} until the game ends.
          </li>
          <li>
            {upper(blocker)} sits on one {path}. Anyone may climb past him with no vote, but he sits on the {points}{" "}
            there, so nobody takes it.
          </li>
          <li>
            Some coins carry a mark. Take one with your own climb and it does something extra, once:
            <ul>
              {Object.values(skin.bonuses).map((b) => (
                <li key={b.name}>
                  <b>
                    {b.glyph} {b.name}:
                  </b>{" "}
                  {b.effect}
                </li>
              ))}
            </ul>
            In your hand it is a plain 2.
          </li>
          <li>
            After your move, any extra moves you have glow. Use them in any order, or press <b>End turn</b>.
          </li>
          <li>Give tokens to anyone, at any time. Deals are made on the call, and nothing makes anyone keep them.</li>
        </ul>
      </details>

      <details>
        <summary>{upper(backPath)} 🔒</summary>
        <p>
          Dashed {backPath} are locked. They open for the mover only when someone offers them {key.glyph} {key.name};
          the climb then needs no vote. No {points} lies on them, and {blocker} never goes there.
        </p>
      </details>

      {favoursOn && (
        <details>
          <summary>Favours</summary>
          <ul>
            <li>
              Each player gets one favour, different for everyone, with two uses. Everyone sees whose favour is whose.
            </li>
            <li>
              A favour helps only someone else’s move, never your own. On another player’s turn, offer yours to them.
              Each use earns you {points} and costs a use. An offer that is not used costs nothing.
            </li>
            <li>
              On your turn, tap another player’s favour to ask for it. They answer yes (it is on offer to you) or no.
              Your move does not wait for the answer.
            </li>
            <li>What the mover gives you for it is agreed on the call, and paid with gifts.</li>
            {Object.values(skin.favours).map((f) => (
              <li key={f.name}>
                <b>
                  {f.glyph} {f.name}:
                </b>{" "}
                {f.effect}
              </li>
            ))}
          </ul>
        </details>
      )}

      <details>
        <summary>The end</summary>
        <p>
          The game ends the moment the {top} is full. {upper(neutrals)} can take seats there too. Only players with a{" "}
          {climber} in the {top} can win: the most {points} wins, and a tie goes to whoever got there first. If the
          admin ends the game early, nobody wins.
        </p>
      </details>
      {n !== undefined && <p className="muted small">This table: {n} players.</p>}
    </section>
  );
}
