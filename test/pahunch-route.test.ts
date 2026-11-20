// The board's path routes (src/games/pahunch/route.ts): every path on every board in boards.json
// goes around the rooms it does not join, so no room card ever hides a path.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { boxOf, exitSide, overlaps, routes } from "../src/games/pahunch/route.ts";
import type { PahunchLayout } from "../src/generated/index.ts";

interface BoardData {
  id: string;
  name: string;
  rooms: { cap: number; x: number; y: number }[];
  paths: { from: number; to: number; back?: boolean }[];
}

const { boards } = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "../crates/pahunch/boards.json"), "utf8"),
) as { boards: BoardData[] };

const layoutOf = (b: BoardData) =>
  ({
    board: b.id,
    name: b.name,
    rooms: b.rooms,
    paths: b.paths.map((p) => ({ ...p, back: p.back ?? false })),
    summit: b.rooms.findIndex((r) => r.cap === 0),
  }) as unknown as PahunchLayout;

describe.each(boards)("board $id", (b) => {
  const layout = layoutOf(b);

  it("routes every path around the rooms it does not join", () => {
    const hits = overlaps(layout);
    const bad = hits.flatMap((n, i) => (n > 0 ? [`${b.paths[i].from}→${b.paths[i].to}`] : []));
    expect(bad).toEqual([]);
  });

  it("starts each path on the top edge of its room (or the side facing a room off to that side) and ends it on the bottom edge of the next", () => {
    routes(layout).forEach((r, i) => {
      const from = boxOf(layout, b.paths[i].from);
      const to = boxOf(layout, b.paths[i].to);
      const side = exitSide(layout, i);
      if (side === 0) {
        expect(r.p[0].y).toBeCloseTo(from.y - from.h / 2);
        expect(Math.abs(r.p[0].x - from.x)).toBeLessThanOrEqual(from.w / 2);
      } else {
        expect(r.p[0].x).toBeCloseTo(from.x + (side * from.w) / 2);
        expect(Math.abs(r.p[0].y - from.y)).toBeLessThanOrEqual(from.h / 2);
        // Only when the room it goes to lies wholly off to that side.
        expect(side * (to.x - from.x)).toBeGreaterThan((from.w + to.w) / 2);
      }
      expect(r.p[3].y).toBeCloseTo(to.y + to.h / 2);
      expect(Math.abs(r.p[3].x - to.x)).toBeLessThanOrEqual(to.w / 2);
    });
  });

  it("keeps coins apart", () => {
    const marks = routes(layout).flatMap((r, i) => (b.paths[i].back ? [] : [r.mid]));
    for (let i = 0; i < marks.length; i++)
      for (let j = i + 1; j < marks.length; j++)
        expect(Math.hypot(marks[i].x - marks[j].x, marks[i].y - marks[j].y)).toBeGreaterThan(4.6);
  });
});
