import { type JSX, useEffect, useState } from "react";
import { DEFAULT_THEME, getTheme } from "../themes/index.ts";
import { goHome } from "./Brand.tsx";
import { Home } from "./Home.tsx";
import { Lobby } from "./Lobby.tsx";
import { useRoom } from "./net.ts";
import { Table } from "./Table.tsx";

function roomFromAddress(): string | null {
  const code = location.hash.slice(1).trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(code) ? code : null;
}

export function App() {
  const [code, setCode] = useState(roomFromAddress);
  const net = useRoom(code);
  const { error, clearError } = net;

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

  const theme = getTheme(net.state?.room.theme ?? DEFAULT_THEME, net.state?.room.cast);

  // The theme's colours for the whole page, background included.
  useEffect(() => {
    const root = document.documentElement.style;
    const vars = Object.entries(theme.chrome);
    for (const [k, v] of vars) root.setProperty(k, v);
    return () => vars.forEach(([k]) => root.removeProperty(k));
  }, [theme.chrome]);

  let body: JSX.Element;
  if (!code) {
    body = <Home send={net.send} online={net.online} />;
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
  } else if (!net.state.game) {
    body = <Lobby state={net.state} send={net.send} join={net.join} theme={theme} />;
  } else {
    body = <Table state={net.state} send={net.send} theme={theme} />;
  }

  return (
    <>
      {body}
      {!net.online && <div className="banner offline">Connection lost. Reconnecting…</div>}
      {error && error.code !== "no-room" && (
        <div className="banner toast" role="alert" onClick={clearError}>
          {error.message}
        </div>
      )}
    </>
  );
}
