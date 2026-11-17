import { useMemo } from "react";
import { encode } from "uqr";

/** `text` as a QR code: dark modules on white with a quiet zone, so any phone camera reads it. */
export function Qr({ text, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => {
    const { data, size } = encode(text, { ecc: "M", border: 0 });
    let d = "";
    data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { size, path: d };
  }, [text]);
  const q = 4;
  return (
    <svg
      className="qr"
      viewBox={`${-q} ${-q} ${size + 2 * q} ${size + 2 * q}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect x={-q} y={-q} width={size + 2 * q} height={size + 2 * q} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
