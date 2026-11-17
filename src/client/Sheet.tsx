import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface Props {
  title: ReactNode;
  /** Accessible name when `title` is not plain text. */
  label?: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * The "more info" surface: everything a hover tooltip says on a desktop, reachable by a tap.
 * A sheet rising from the bottom edge on phones, a centred panel on wide screens.
 * Closes on Escape, a tap outside, or the ✕.
 */
export function Sheet({ title, label, onClose, children }: Props) {
  const back = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Escape closes only the top sheet (the QR code opens over the room sheet).
    const onKey = (e: KeyboardEvent) => {
      const open = document.querySelectorAll(".sheet-back");
      if (e.key === "Escape" && open[open.length - 1] === back.current) onClose();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  // In a portal: sticky and transformed ancestors would otherwise trap the fixed overlay.
  return createPortal(
    // React events cross portals: stop them here, or a tappable parent (a seat) would reopen the sheet.
    <div
      ref={back}
      className="overlay sheet-back"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label ?? (typeof title === "string" ? title : undefined)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="menu-head sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
