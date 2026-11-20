import { gameOf } from "../games/index.ts";
import type { ClientMsg } from "../generated/index.ts";
import { Lobby } from "./Lobby.tsx";
import type { Reaction, RoomState } from "./net.ts";

interface Props {
  state: RoomState;
  send: (m: ClientMsg) => void;
  join: (room: string, name?: string) => void;
  reactions: Reaction[];
}

/** A room once the server has sent its state: the lobby, or the table of the room's game. */
export function Room({ state, send, join, reactions }: Props) {
  const { room } = state;
  const game = gameOf(room.theme);
  if (!state.game) {
    const skin = game.skin(room.theme, room.cast);
    return <Lobby state={state} send={send} join={join} game={game} skin={skin} reactions={reactions} />;
  }
  return <game.Table state={state} send={send} reactions={reactions} />;
}
