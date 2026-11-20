import type { MouseEvent } from "react";

/** Leaves the room screen for Home without a page load (the socket stays and parts the room). */
export function goHome(e?: MouseEvent) {
  if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)) return; // new tab: let the link do it
  e?.preventDefault();
  location.hash = "";
  history.replaceState(null, "", location.pathname + location.search);
}

/** The logo; on every screen it leads Home. */
export function Brand({ as = "span" }: { as?: "span" | "h1" }) {
  const link = (
    <a className="brand-link" href="/" onClick={goHome} title="Home">
      Game Adda
    </a>
  );
  return as === "h1" ? <h1 className="brand">{link}</h1> : <span className="brand">{link}</span>;
}
