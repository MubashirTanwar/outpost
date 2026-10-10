/** Turn plain mentions of games and moves in coach text into game:/move: markdown links. */
import type { DayGame, WorstMoment } from "./types.ts";

export interface RefContext {
  username: string;
  day?: string;
  games: DayGame[];
  moments: WorstMoment[];
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Turn plain mentions of opponents and key moves into links:
 *   opponent name  -> [name](game:<id>)
 *   **Bb5+** / Bb5+ -> [**Bb5+**](move:<id>:<ply>) when it's one of the day's key moves
 * Existing markdown links are left alone. When a move appears in several games, the game
 * whose opponent is named in the same paragraph wins.
 */
export function linkify(markdown: string, ctx: RefContext): string {
  return repairLinks(markdown, ctx)
    .split(/\n{2,}/)
    .map((para) => {
      const parts = para.split(/(\[[^\]]*\]\([^)]*\))/g);
      const mentioned = ctx.games.filter((g) => new RegExp(`(?<![\\w-])${escapeRe(g.opponent)}(?![\\w-])`, "i").test(para));
      const linkedOpp = new Set<string>();
      const linkedMove = new Set<string>();
      return parts
        .map((part, i) => {
          if (i % 2 === 1) return part; // an existing link
          // Stray references the model wrote as text, e.g. "Bob (game:abc123)": drop them.
          let out = part.replace(/\s*\(?`?\b(?:game|move):[\w:.-]+`?\)?/g, "");
          // Moves: played SAN first, then best SAN (both open the same moment).
          const candidates = ctx.moments
            .map((m) => ({ m, preferred: mentioned.some((g) => g.id === m.game_id) }))
            .sort((a, b) => Number(b.preferred) - Number(a.preferred));
          for (const kind of ["san", "best_san"] as const) {
            for (const { m } of candidates) {
              const san = m[kind];
              if (!san || linkedMove.has(san)) continue;
              // Match with or without the check/mate sign, and never inside a longer move (O-O vs O-O-O).
              const base = san.replace(/[+#]$/, "");
              const re = new RegExp(`(\\*\\*)?(?<![\\w\\]-])${escapeRe(base)}[+#]?(?![\\w-])(\\*\\*)?`);
              if (re.test(out)) {
                out = out.replace(re, `[**${san}**](move:${m.game_id}:${m.ply}${kind === "best_san" ? ":best" : ""})`);
                linkedMove.add(san);
              }
            }
          }
          for (const g of ctx.games) {
            if (linkedOpp.has(g.opponent)) continue;
            const re = new RegExp(`(?<![\\w\\[-])${escapeRe(g.opponent)}(?![\\w-])`, "i");
            if (re.test(out)) {
              out = out.replace(re, (name) => `[${name}](game:${g.id})`);
              linkedOpp.add(g.opponent);
            }
          }
          return out;
        })
        .join("");
    })
    .join("\n\n");
}


const LINK = /\[([^\]]*)\]\(\s*<?((?:game|move):[^)>\s]*)>?(?:\s+"[^"]*")?\s*\)/g;

/** The day's game a model-written reference means: exact id, a fragment of it, or the opponent's name. */
function findGame(ctx: RefContext, ref: string, label: string): DayGame | undefined {
  const r = ref.trim().toLowerCase();
  const name = label.replace(/[*_`]/g, "").trim().toLowerCase();
  return (
    ctx.games.find((g) => g.id.toLowerCase() === r) ??
    (r.length >= 6 ? ctx.games.find((g) => g.id.toLowerCase().startsWith(r) || r.endsWith(g.id.toLowerCase())) : undefined) ??
    ctx.games.find((g) => g.opponent.toLowerCase() === r || g.opponent.toLowerCase() === name)
  );
}

/**
 * Models often get link targets slightly wrong (made-up or truncated ids, the opponent's name as
 * the id, angle brackets). Point each game:/move: link at a real game, or unwrap it to plain text
 * so the normal name/move linking can take over. A link is never left pointing nowhere.
 */
export function repairLinks(markdown: string, ctx: RefContext): string {
  return markdown.replace(LINK, (_, label: string, target: string) => {
    const [kind, ref = "", ply, best] = target.split(":");
    const game = findGame(ctx, ref, label);
    if (!game) return label;
    if (kind === "move" && ply && /^\d+$/.test(ply)) return `[${label}](move:${game.id}:${ply}${best === "best" ? ":best" : ""})`;
    return `[${label}](game:${game.id})`;
  });
}
