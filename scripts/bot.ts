import type { Action, View } from "../src/generated/index.ts";

/**
 * A player that makes random legal moves. Used by the socket tests and by scripts/bots.ts for
 * solo testing; it is not meant to play well. It plays through the wire protocol, so it is not
 * part of the engine.
 */
export function chooseAction(v: View, random: () => number): Action | null {
  const me = v.you;
  if (me === null || !v.pending.includes(me)) return null;
  const money = v.players[me].money ?? 0;
  const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
  const upTo = (max: number) => Math.floor(random() * (max + 1));
  const a = v.auction;

  if (!a) {
    const card = pick(v.hand);
    if (card.type === "double" && random() < 0.6) {
      const seconds = v.hand.filter((c) => c.suit === card.suit && c.type !== "double");
      if (seconds.length) return { type: "play", card: card.id, second: pick(seconds).id };
    }
    return { type: "play", card: card.id };
  }

  switch (a.kind) {
    case "open": {
      const raise = a.high + 1 + upTo(4);
      if (raise <= money && a.high < 40 && random() < 0.4) return { type: "bid", amount: raise, seenHigh: a.high };
      return { type: "done", seenHigh: a.high };
    }
    case "once": {
      const raise = a.high + 1 + upTo(6);
      if (raise <= money && random() < 0.5) return { type: "bid", amount: raise };
      return { type: "pass" };
    }
    case "sealed":
      return { type: "sealed", amount: upTo(Math.min(money, 30)) };
    case "fixed":
      if (a.price === null) return { type: "price", amount: upTo(Math.min(money, 30)) };
      return a.price <= money && random() < 0.4 ? { type: "accept" } : { type: "pass" };
    case "offer": {
      const seconds = v.hand.filter((c) => c.suit === a.cards[0].suit && c.type !== "double");
      if (seconds.length && random() < 0.5) return { type: "add", card: pick(seconds).id };
      return { type: "decline" };
    }
  }
}
