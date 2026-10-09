/**
 * Kittu, the coach: a fluffy cream longhair with amber eyes, a pink nose and a grey blaze,
 * drawn as SVG so every expression is crisp at any size and needs no image assets.
 */
import type { Classification } from "@/lib/types";

export type KittuMood =
  | "neutral" // the classic serious stare
  | "happy" // good moves
  | "starry" // brilliant / great
  | "proud" // best move, book knowledge
  | "unimpressed" // inaccuracy: half-lidded side-eye
  | "worried" // mistake
  | "shocked" // blunder
  | "sad" // missed chance, lost game
  | "thinking" // waiting for your move
  | "party"; // lesson complete

const C = {
  fur: "#f3d5b0",
  furShade: "#e2b88a",
  furLight: "#fbe9d3",
  blaze: "#cdc3bd",
  muzzle: "#fff4e6",
  innerEar: "#f2b3ae",
  nose: "#e8958f",
  iris: "#d98a2b",
  irisDark: "#a95d14",
  pupil: "#24160c",
  line: "#7a4f2a",
};

/** A ragged, fluffy outline around (cx, cy). */
function fluff(cx: number, cy: number, rx: number, ry: number, tufts: number, depth: number, phase = 0): string {
  const pts: string[] = [];
  for (let i = 0; i <= tufts * 2; i++) {
    const a = phase + (i / (tufts * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? 1 : 1 - depth;
    pts.push(`${(cx + Math.cos(a) * rx * r).toFixed(1)},${(cy + Math.sin(a) * ry * r).toFixed(1)}`);
  }
  // Smooth through the points with quadratic curves for a soft, furry edge.
  let d = `M${pts[0]}`;
  for (let i = 1; i < pts.length; i += 2) d += ` Q${pts[i]} ${pts[i + 1] ?? pts[0]}`;
  return d + "Z";
}

function Eye({ x, mood, side }: { x: number; mood: KittuMood; side: -1 | 1 }) {
  const y = 98;
  if (mood === "happy" || mood === "party") {
    // ^ ^ closed happy eyes
    return <path d={`M${x - 11},${y + 3} Q${x},${y - 10} ${x + 11},${y + 3}`} stroke={C.line} strokeWidth="4.5" fill="none" strokeLinecap="round" />;
  }
  const rx = mood === "shocked" ? 14 : 12.5;
  const ry = mood === "shocked" ? 15 : mood === "unimpressed" ? 12 : 13;
  const pupilW = mood === "shocked" ? 3 : mood === "starry" ? 7 : mood === "sad" || mood === "worried" ? 6.5 : 5;
  const look = mood === "unimpressed" ? 4 * side * -1 + 4 : mood === "thinking" ? 4 : 0;
  const lookY = mood === "thinking" ? -4 : mood === "sad" ? 3 : 0;
  return (
    <g>
      <ellipse cx={x} cy={y} rx={rx + 2} ry={ry + 2} fill={C.furShade} opacity="0.55" />
      <ellipse cx={x} cy={y} rx={rx} ry={ry} fill={`url(#kittu-iris)`} stroke={C.line} strokeWidth="1.6" />
      {mood === "starry" ? (
        <path
          transform={`translate(${x},${y})`}
          d="M0,-9 L2.6,-2.8 L9,-2.6 L4,1.6 L5.6,8 L0,4.4 L-5.6,8 L-4,1.6 L-9,-2.6 L-2.6,-2.8Z"
          fill="#fff7c2"
          stroke="#f0b52c"
          strokeWidth="1"
        />
      ) : (
        <ellipse cx={x + look} cy={y + lookY} rx={pupilW} ry={ry - 2.5} fill={C.pupil} />
      )}
      <circle cx={x - 4 + look} cy={y - 5 + lookY} r="3.2" fill="#fff" />
      <circle cx={x + 4 + look} cy={y + 4 + lookY} r="1.4" fill="#fff" opacity="0.8" />
      {/* Eyelids: half-lidded stare, worried/sad tilt */}
      {mood === "unimpressed" && <path d={`M${x - rx - 2},${y - 1} L${x + rx + 2},${y - 1} L${x + rx + 2},${y - ry - 3} L${x - rx - 2},${y - ry - 3}Z`} fill={C.fur} />}
      {mood === "unimpressed" && <path d={`M${x - rx},${y - 1} L${x + rx},${y - 1}`} stroke={C.line} strokeWidth="2.5" strokeLinecap="round" />}
      {mood === "neutral" && (
        <path d={`M${x - rx - 1},${y - ry + 3} Q${x},${y - ry - 1} ${x + rx + 1},${y - ry + 3} L${x + rx + 1},${y - ry - 4} L${x - rx - 1},${y - ry - 4}Z`} fill={C.fur} />
      )}
      {mood === "proud" && (
        <path d={`M${x - rx - 2},${y + 2} Q${x},${y - 6} ${x + rx + 2},${y + 2} L${x + rx + 2},${y - ry - 4} L${x - rx - 2},${y - ry - 4}Z`} fill={C.fur} />
      )}
      {mood === "proud" && <path d={`M${x - rx},${y + 1} Q${x},${y - 6} ${x + rx},${y + 1}`} stroke={C.line} strokeWidth="2.4" fill="none" strokeLinecap="round" />}
      {(mood === "sad" || mood === "worried") && (
        <path
          d={side < 0 ? `M${x - rx - 2},${y - ry - 2} L${x + rx + 2},${y - ry - 2} L${x + rx + 2},${y - ry + 6}Z` : `M${x - rx - 2},${y - ry - 2} L${x + rx + 2},${y - ry - 2} L${x - rx - 2},${y - ry + 6}Z`}
          fill={C.fur}
        />
      )}
    </g>
  );
}

function Mouth({ mood }: { mood: KittuMood }) {
  const y = 128;
  const s = { stroke: C.line, strokeWidth: 2.6, fill: "none", strokeLinecap: "round" as const };
  switch (mood) {
    case "happy":
    case "party":
    case "starry":
      return (
        <g>
          <path d={`M88,${y - 2} Q94,${y + 12} 100,${y + 1} Q106,${y + 12} 112,${y - 2}`} {...s} />
          <path d={`M92,${y + 3} Q100,${y + 16} 108,${y + 3} Q100,${y + 9} 92,${y + 3}Z`} fill="#d8676b" />
        </g>
      );
    case "shocked":
      return <ellipse cx="100" cy={y + 6} rx="7" ry="9" fill="#5a2d22" stroke={C.line} strokeWidth="2" />;
    case "worried":
      return <path d={`M89,${y + 7} Q94,${y + 1} 100,${y + 5} Q106,${y + 1} 111,${y + 7}`} {...s} />;
    case "sad":
      return <path d={`M91,${y + 8} Q100,${y - 1} 109,${y + 8}`} {...s} />;
    case "unimpressed":
      return <path d={`M92,${y + 3} L108,${y + 3}`} {...s} />;
    case "proud":
      return <path d={`M90,${y} Q95,${y + 7} 100,${y + 1} Q106,${y + 8} 112,${y - 2}`} {...s} />;
    default:
      return <path d={`M91,${y} Q95.5,${y + 5} 100,${y + 1} Q104.5,${y + 5} 109,${y}`} {...s} />;
  }
}

function Brows({ mood }: { mood: KittuMood }) {
  const s = { stroke: C.furShade, strokeWidth: 3.5, fill: "none", strokeLinecap: "round" as const };
  if (mood === "worried" || mood === "sad")
    return (
      <g>
        <path d="M60,76 L80,70" {...s} />
        <path d="M140,76 L120,70" {...s} />
      </g>
    );
  if (mood === "unimpressed" || mood === "thinking")
    return (
      <g>
        <path d="M60,79 L82,79" {...s} />
        <path d="M118,74 Q130,66 141,72" {...s} />
      </g>
    );
  if (mood === "shocked")
    return (
      <g>
        <path d="M60,70 Q70,62 82,67" {...s} />
        <path d="M118,67 Q130,62 140,70" {...s} />
      </g>
    );
  return null;
}

export function Kittu({ mood = "neutral", size = 64, className = "", title }: { mood?: KittuMood; size?: number; className?: string; title?: string }) {
  const earsBack = mood === "shocked" || mood === "worried" || mood === "sad";
  const puffed = mood === "shocked";
  const earTilt = earsBack ? 14 : mood === "thinking" ? -4 : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" className={className} role="img" aria-label={title ?? `Kittu looks ${mood}`}>
      <defs>
        <radialGradient id="kittu-iris" cx="45%" cy="40%" r="65%">
          <stop offset="0%" stopColor="#f6b552" />
          <stop offset="60%" stopColor={C.iris} />
          <stop offset="100%" stopColor={C.irisDark} />
        </radialGradient>
        <linearGradient id="kittu-blaze" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={C.blaze} stopOpacity="0.15" />
          <stop offset="45%" stopColor={C.blaze} stopOpacity="0.7" />
          <stop offset="100%" stopColor={C.blaze} stopOpacity="0.35" />
        </linearGradient>
        <radialGradient id="kittu-head" cx="50%" cy="38%" r="65%">
          <stop offset="0%" stopColor={C.furLight} />
          <stop offset="70%" stopColor={C.fur} />
          <stop offset="100%" stopColor={C.furShade} />
        </radialGradient>
      </defs>

      {/* Chest ruff */}
      <path d={fluff(100, 182, puffed ? 78 : 70, 40, 11, 0.12, 0.2)} fill={C.furLight} stroke={C.furShade} strokeWidth="1.5" />

      {/* Ears */}
      <g transform={`rotate(${-earTilt} 62 70)`}>
        <path d="M36,80 Q38,44 50,34 Q56,32 84,56Z" fill={C.fur} stroke={C.furShade} strokeWidth="2" strokeLinejoin="round" />
        <path d="M45,72 Q47,50 53,44 Q58,44 74,58Z" fill={C.innerEar} />
        <path d="M50,64 L53,50 M57,64 L59,52 M63,64 L66,56" stroke="#fff6ec" strokeWidth="2.2" strokeLinecap="round" />
      </g>
      <g transform={`rotate(${earTilt} 138 70)`}>
        <path d="M164,80 Q162,44 150,34 Q144,32 116,56Z" fill={C.fur} stroke={C.furShade} strokeWidth="2" strokeLinejoin="round" />
        <path d="M155,72 Q153,50 147,44 Q142,44 126,58Z" fill={C.innerEar} />
        <path d="M150,64 L147,50 M143,64 L141,52 M137,64 L134,56" stroke="#fff6ec" strokeWidth="2.2" strokeLinecap="round" />
      </g>

      {/* Cheek ruff behind the face, then the round fluffy head (Persian-style flat face) */}
      <path d={fluff(100, 122, puffed ? 92 : 84, puffed ? 62 : 54, 22, puffed ? 0.14 : 0.08, 0.05)} fill={C.furShade} opacity="0.9" />
      <path d={fluff(100, 108, puffed ? 80 : 73, puffed ? 70 : 64, 26, puffed ? 0.1 : 0.045, 0.1)} fill="url(#kittu-head)" stroke={C.furShade} strokeWidth="1.2" />

      {/* Grey blaze between the eyes and down the nose */}
      <path d="M100,60 C84,68 88,86 94,98 C96,106 98,110 100,112 C102,110 104,106 106,98 C112,86 116,68 100,60Z" fill="url(#kittu-blaze)" />
      {/* Forehead stripes */}
      <path d="M92,58 Q94,66 93,72 M100,54 L100,66 M108,58 Q106,66 107,72" stroke={C.furShade} strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.45" />

      <Brows mood={mood} />
      <Eye x={74} mood={mood} side={-1} />
      <Eye x={126} mood={mood} side={1} />

      {/* Muzzle, nose, whiskers */}
      <ellipse cx="88" cy="126" rx="15" ry="11" fill={C.muzzle} />
      <ellipse cx="112" cy="126" rx="15" ry="11" fill={C.muzzle} />
      <path d="M93,111 Q100,107 107,111 L100,119Z" fill={C.nose} stroke="#c86f6a" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M100,119 L100,124" stroke={C.line} strokeWidth="2" strokeLinecap="round" />
      <Mouth mood={mood} />
      <g stroke="#fffaf3" strokeWidth="1.6" strokeLinecap="round" opacity="0.95">
        <path d="M78,124 Q50,118 22,121" fill="none" />
        <path d="M78,129 Q50,130 24,136" fill="none" />
        <path d="M122,124 Q150,118 178,121" fill="none" />
        <path d="M122,129 Q150,130 176,136" fill="none" />
      </g>
      {(mood === "happy" || mood === "party" || mood === "starry") && (
        <g fill="#f4a3a0" opacity="0.55">
          <ellipse cx="58" cy="118" rx="9" ry="5" />
          <ellipse cx="142" cy="118" rx="9" ry="5" />
        </g>
      )}

      {/* Extras */}
      {mood === "worried" && <path d="M156,70 Q164,84 156,90 Q148,84 156,70Z" fill="#9fd3f7" stroke="#5aa7d8" strokeWidth="1.2" />}
      {mood === "sad" && <path d="M64,110 Q68,122 64,128 Q60,122 64,110Z" fill="#9fd3f7" stroke="#5aa7d8" strokeWidth="1.2" />}
      {mood === "thinking" && (
        <g fill="#fff" stroke={C.furShade} strokeWidth="1.5">
          <circle cx="170" cy="42" r="5" />
          <circle cx="182" cy="26" r="7.5" />
        </g>
      )}
      {mood === "starry" && (
        <g fill="#ffe27a">
          <path d="M28,40 l3,8 8,3 -8,3 -3,8 -3,-8 -8,-3 8,-3Z" />
          <path d="M172,34 l2.5,6 6,2.5 -6,2.5 -2.5,6 -2.5,-6 -6,-2.5 6,-2.5Z" />
          <path d="M178,92 l2,5 5,2 -5,2 -2,5 -2,-5 -5,-2 5,-2Z" />
        </g>
      )}
      {mood === "shocked" && (
        <g stroke="#fa412d" strokeWidth="3.5" strokeLinecap="round">
          <path d="M24,52 L36,62 M18,74 L32,76 M176,52 L164,62 M182,74 L168,76" />
        </g>
      )}
      {mood === "party" && (
        <g transform="rotate(18 128 30)">
          <path d="M108,52 L128,-4 L148,52Z" fill="#fff4e8" stroke="#d9c6b4" strokeWidth="1.5" />
          <path d="M116,40 l4,4 M126,24 l4,4 M134,42 l4,4 M122,10 l3,3" stroke="#d24a4a" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="128" cy="-4" r="7" fill="#d24a4a" />
        </g>
      )}

    </svg>
  );
}

/** Kittu's reaction to a reviewed move. */
export function moodForClassification(cls: Classification | null | undefined): KittuMood {
  switch (cls) {
    case "brilliant":
    case "great":
      return "starry";
    case "best":
    case "book":
      return "proud";
    case "excellent":
    case "good":
    case "forced":
      return "happy";
    case "inaccuracy":
      return "unimpressed";
    case "mistake":
      return "worried";
    case "miss":
      return "sad";
    case "blunder":
      return "shocked";
    default:
      return "neutral";
  }
}

export const KITTU_LINES: Record<KittuMood, string[]> = {
  starry: ["Purr-fect! I didn't even see that one.", "Now THAT is a move. Treats for you."],
  proud: ["Exactly what I'd play. Obviously.", "Textbook. I approve."],
  happy: ["Nice. Keep it up.", "Good move, human."],
  unimpressed: ["Hmm. There was something better.", "I've seen you do better."],
  worried: ["Uh-oh. That gives something away.", "My whiskers are twitching. Careful."],
  shocked: ["HISS! What did you just do?!", "My fur is standing up. That's a blunder."],
  sad: ["They blundered and you let them off…", "That was a free fish, and you didn't take it."],
  thinking: ["Your move. Take your time.", "What's the plan here?"],
  neutral: ["Let's look at this together.", "Show me what you've got."],
  party: ["You did it! Cake time.", "Lesson complete. Proud of you."],
};
