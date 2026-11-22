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

  // Favour picks on a climb, and where the blocker goes.
  swapPick: "Token swap: take instead",
  swapOwn: "The token on the way",
  onTheWay: "on the way",
  swapFrom: (value: number, route: string) => `The ${value} from ${route}`,
  carryPick: "Carry: take along",
  nobody: "Nobody",
  carryOwn: (climbers: string) => `Another of your ${climbers}`,
  carryNeutral: (neutral: string) => `An ${neutral}`,
  blockPick: (blocker: string) => `Send ${blocker} to`,

  // The sheets a tap on the board opens: what the thing does, then its facts as chips (their words
  // in the labels), then the small print.
  blockerLead: (blocker: string, points: string) =>
    `Anyone may climb past ${blocker} with no vote, but nobody takes the ${points} under him.`,
  blockerCovered: (points: string, favour: string) =>
    `Unless ${favour} is on offer: then the mover takes those ${points}.`,
  blockerMove: (blocker: string, climber: string, path: string, points: string, backPath: string) =>
    `On your turn, instead of moving a ${climber}, you may send ${blocker} to another ${path} with ${points} on it, never onto ${backPath}. Tap him, then tap where he goes.`,
  backLead: (key: string, points: string) =>
    `Locked. Only when someone offers the mover ${key} may they climb it, with no vote. No ${points} lies here.`,
  blockedLead: (blocker: string, points: string) =>
    `${blocker} sits here: climbing it needs no vote, and takes no ${points}.`,
  plainLead: (points: string) => `It leaves a post of one: climbing it needs no vote and takes no ${points}.`,
  pathLead: (need: number, room: string) => `Climbing it takes ${need} yes votes from the ${room}.`,
  nudgeNote: (neutral: string, points: string) =>
    `An ${neutral} may be nudged up it too: no vote, and +1 ${points} for whoever nudges.`,
  topLead: (climber: string) => `The game ends the moment it is full. Only players with a ${climber} here can win.`,
  topNote: (neutrals: string) =>
    `${neutrals.charAt(0).toUpperCase()}${neutrals.slice(1)} take seats here but never win.`,
  postLead: "A post of one: leaving it needs no vote.",
  roomLead: (need: number, cap: number) => `Leaving takes ${need} yes votes of its ${cap} seats.`,
  entryNote: (climbers: string) => `New ${climbers} join here.`,
  factVotes: (need: number, cap: number) => `${need} yes of ${cap} to leave`,
  factOn: (from: string, to: string) => `On the way from the ${from} up to the ${to}`,
  factWay: (kind: string, from: string, to: string) => `A ${kind} from the ${from} up to the ${to}`,
  factBlocker: (blocker: string) => `${blocker} sits here`,
  factKey: "The key is on offer this turn",
  factSeats: (held: number, cap: number, who: string) => `${held} of ${cap} seats taken${who ? `: ${who}` : ""}`,
  swapFor: (glyph: string, from: number, to: number) => `${glyph} ${from} ⇢ ${to}`,

  // What a vote uses, for the voters.
  votesFor: "What this climb uses",
  usesSwap: (owner: string, from: number | null, to: number) =>
    `${owner}’s token swap: the climber takes the ${to} instead of ${from === null ? "nothing" : `the ${from}`}`,
  usesCarry: (owner: string, who: string) => `${owner}’s favour: ${who} goes up too`,
  usesSqueeze: (owner: string) => `${owner}’s favour: one extra squeezes into the full room`,
} as const;
