import { useState } from "react";
import type { ClientMsg, ThemeId } from "../generated/index.ts";
import { THEME_IDS, THEMES } from "../themes/index.ts";
import { LookButton } from "./Avatar.tsx";
import { Brand } from "./Brand.tsx";
import { savedName, savedPrefs, savedTheme, saveName, saveTheme, useSavedLook } from "./net.ts";

export function Home({ send, online }: { send: (m: ClientMsg) => void; online: boolean }) {
  const [name, setName] = useState(savedName);
  const [look, setLook] = useSavedLook();
  const [theme, setTheme] = useState<ThemeId>(() => THEME_IDS.find((id) => id === savedTheme()) ?? THEME_IDS[0]);
  const [code, setCode] = useState("");
  const cleanCode = code.trim().toUpperCase();

  return (
    <main className="center-card home">
      <Brand as="h1" />
      <p className="muted">
        An auction card game for 3–5 friends. Everyone joins from their own device; keep the voice chat going.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          saveName(name.trim());
          saveTheme(theme);
          send({ type: "create", theme, name, prefs: savedPrefs(theme), avatar: look });
        }}
      >
        <div className="you-row">
          <LookButton code={look} name={name.trim()} onChange={setLook} className="big" />
          <label>
            Your name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              placeholder="e.g. Chintu"
              autoFocus
            />
          </label>
        </div>
        <fieldset>
          <legend>Theme</legend>
          {THEME_IDS.map((id) => (
            <label key={id} className={`theme-pick ${theme === id ? "on" : ""}`}>
              <input type="radio" name="theme" checked={theme === id} onChange={() => setTheme(id)} />
              <span>
                <b>{THEMES[id].title}</b>
                <small>{THEMES[id].tagline}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <button className="btn primary big" disabled={!name.trim() || !online}>
          Create a room
        </button>
      </form>

      <form
        className="join-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (/^[A-Z0-9]{6}$/.test(cleanCode)) location.hash = cleanCode;
        }}
      >
        <label>
          Or join with a room code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={6}
            placeholder="ABC234"
            className="code-input"
          />
        </label>
        <button className="btn" disabled={!/^[A-Z0-9]{6}$/.test(cleanCode)}>
          Join
        </button>
      </form>

      <p className="muted">
        <small>
          Free software under the AGPL-3.0. <a href="https://github.com/Dr-Blank/auction-adda">Source code</a>
        </small>
      </p>
    </main>
  );
}
