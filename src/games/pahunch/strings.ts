// Pahunch's words, as whole templates with named slots, so a translation can change their order.
// Strings move here as each one is touched; the theme's nouns (skin.ts) fill the slots.

export const S = {
  // The confirm strip: every move waits for a second tap here, away from the button it came from.
  confirm: "✓ Confirm",
  back: "↩ Back",
  confirmLabel: (what: string) => `Confirm: ${what}`,

  // Taking back the last move.
  undo: "↩ Undo",
  undoMine: "Take back your last move",
  undoTheirs: (name: string) => `Take back ${name}’s last move`,
  undoAny: "Take back the last move",
  undoWhat: (whose: string) => `↩ Undo ${whose} move`,
  logUndo: (who: string) => `${who} took back the last move.`,

  // After the main move, while a favour could still help.
  endTurn: "⏭ End turn",
  waitFavour: "🤝 A favour may still help: ask for one, or end your turn",

  // Tips.
  tipsSwitch: "💡 Tips",
  tipsHint: "Show the 💡 tips on the table",

  // A move in words, for the confirm strip and screen readers.
  enter: (climber: string, room: string) => `✚ Add a ${climber} → ${room}`,
  climb: (from: string, to: string) => `↑ ${from} → ${to}`,
  askVotes: (from: string, to: string) => `🗳️ Ask for votes: ${from} → ${to}`,
  voteYes: (n: number) => (n > 1 ? `✓ Yes ×${n}` : "✓ Yes"),
  voteNo: "✗ No",
  bribe: (neutral: string, token: number) => `🍬 Pay an ${neutral} a ${token}`,
  take: "↑ Go up with the picked yes",
  withdraw: "✗ Give up the climb",
  nudge: (neutral: string, from: string, to: string) => `⇡ Nudge an ${neutral}: ${from} → ${to} · +1`,
  block: (blocker: string, from: string, to: string) => `➜ Send ${blocker}: ${from} → ${to}`,
  lend: (favour: string, mover: string) => `🤝 Offer ${favour} → ${mover}`,
  unlend: (favour: string) => `↩ Take back ${favour}`,
  request: (owner: string, favour: string) => `🙏 Ask ${owner} for ${favour}`,
  unrequest: (owner: string, favour: string) => `↩ Drop the ask to ${owner} for ${favour}`,
  turnDown: (owner: string, favour: string) => `✕ Turn down ${owner}’s ${favour}`,
  decline: (favour: string) => `✗ Keep your ${favour}`,
  give: (count: string, points: string, to: string) => `🎁 Give ${count} (${points}) → ${to}`,
  plead: (to: string, count: number) => `🙏 Ask ${to} for 🪙 × ${count}`,
  offer: (to: string, give: string, want: string) => `⇄ Offer ${to} ${give} for ${want}`,
  accept: (from: string) => `✓ Swap with ${from}`,
  refuse: (from: string) => `✗ Say no to ${from}`,
  recallPlea: (to: string) => `↩ Take back your ask to ${to}`,
  recallOffer: (to: string) => `↩ Take back your swap with ${to}`,
  carryWith: (glyph: string, who: string) => `${glyph} + ${who}`,
  swapFor: (glyph: string, from: number, to: number) => `${glyph} ${from} ⇢ ${to}`,

  // What a vote uses, for the voters.
  votesFor: "What this climb uses",
  usesSwap: (owner: string, from: number | null, to: number) =>
    `${owner}’s token swap: the climber takes the ${to} instead of ${from === null ? "nothing" : `the ${from}`}`,
  usesCarry: (owner: string, who: string) => `${owner}’s favour: ${who} goes up too`,
  usesSqueeze: (owner: string) => `${owner}’s favour: one extra squeezes into the full room`,
} as const;
