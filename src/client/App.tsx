import { type JSX, useEffect, useState } from "react";
import { DEFAULT_THEME, skinOf } from "../games/index.ts";
import { goHome } from "./Brand.tsx";
import { Home } from "./Home.tsx";
import { useRoom } from "./net.ts";
import { Room } from "./Room.tsx";

function roomFromAddress(): string | null {
  const code = location.hash.slice(1).trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(code) ? code : null;
}

export function App() {
  const [code, setCode] = useState(roomFromAddress);
  const net = useRoom(code);
  const { error, clearError, notice, clearNotice } = net;

  useEffect(() => {
    const onHash = () => {
      setCode(roomFromAddress());
      clearError();
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!error || error.code === "no-room") return;
    const timer = setTimeout(clearError, 4000);
    return () => clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(clearNotice, 7000);
    return () => clearTimeout(timer);
  }, [notice]);

  const skin = skinOf(net.state?.room.theme ?? DEFAULT_THEME, net.state?.room.cast);

  // The theme's colours for the whole page, background included.
  useEffect(() => {
    const root = document.documentElement.style;
    const vars = Object.entries(skin.chrome);
    for (const [k, v] of vars) root.setProperty(k, v);
    return () => vars.forEach(([k]) => root.removeProperty(k));
  }, [skin.chrome]);

  let body: JSX.Element;
  if (!code) {
    body = <Home send={net.send} online={net.online} myRooms={net.myRooms} listRooms={net.listRooms} />;
  } else if (!net.state && error?.code === "no-room") {
    body = (
      <main className="center-card">
        <h1>Room not found</h1>
        <p>
          Room <b>{code}</b> does not exist. It may have expired, or the link is mistyped.
        </p>
        <a className="btn primary" href="/" onClick={goHome}>
          Back to start
        </a>
      </main>
    );
  } else if (!net.state) {
    body = <main className="center-card">Connecting…</main>;
  } else {
    body = <Room state={net.state} send={net.send} join={net.join} reactions={net.reactions} />;
  }

  return (
    <>
      {body}
      {!net.online && <div className="banner offline">Connection lost. Reconnecting…</div>}
      {error && error.code !== "no-room" ? (
        <div className="banner toast" role="alert" onClick={clearError}>
          {error.message}
        </div>
      ) : (
        notice && (
          <div className="banner toast notice" role="status" onClick={clearNotice}>
            {notice.message}
          </div>
        )
      )}
    </>
  );
}
