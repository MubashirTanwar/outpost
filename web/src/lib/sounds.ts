"use client";

/**
 * Board sounds synthesised with the Web Audio API: wooden "thock" for moves, a sharper
 * double knock for captures, a tone for check, etc. No audio files to license or load.
 */

export type SoundKind = "move" | "capture" | "check" | "castle" | "promote" | "end" | "correct" | "wrong" | "notify";

let ctx: AudioContext | null = null;
let muted = false;

try {
  muted = typeof window !== "undefined" && window.localStorage.getItem("cc-muted") === "1";
} catch {}

export function isMuted() {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  try {
    window.localStorage.setItem("cc-muted", value ? "1" : "0");
  } catch {}
}

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** A short filtered noise burst: sounds like a piece landing on a wooden board. */
function knock(ac: AudioContext, at: number, { freq = 900, q = 1.2, gain = 0.9, decay = 0.07 } = {}) {
  const len = Math.floor(ac.sampleRate * 0.12);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + decay);
  src.connect(bp).connect(g).connect(ac.destination);
  src.start(at);
  src.stop(at + 0.13);

  // Low body resonance.
  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq / 4, at);
  osc.frequency.exponentialRampToValueAtTime(freq / 8, at + decay);
  const og = ac.createGain();
  og.gain.setValueAtTime(gain * 0.5, at);
  og.gain.exponentialRampToValueAtTime(0.001, at + decay);
  osc.connect(og).connect(ac.destination);
  osc.start(at);
  osc.stop(at + decay + 0.02);
}

function tone(ac: AudioContext, at: number, freq: number, dur: number, type: OscillatorType = "sine", gain = 0.25) {
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

export function playSound(kind: SoundKind) {
  if (muted) return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.005;
  switch (kind) {
    case "move":
      knock(ac, t);
      break;
    case "capture":
      knock(ac, t, { freq: 1300, gain: 1, decay: 0.05 });
      knock(ac, t + 0.06, { freq: 700, gain: 0.8 });
      break;
    case "castle":
      knock(ac, t);
      knock(ac, t + 0.11, { freq: 800 });
      break;
    case "check":
      knock(ac, t);
      tone(ac, t + 0.02, 880, 0.18, "triangle", 0.18);
      break;
    case "promote":
      knock(ac, t);
      tone(ac, t + 0.03, 660, 0.1, "triangle", 0.15);
      tone(ac, t + 0.12, 990, 0.16, "triangle", 0.15);
      break;
    case "end":
      tone(ac, t, 523, 0.25, "sine", 0.2);
      tone(ac, t + 0.18, 659, 0.25, "sine", 0.2);
      tone(ac, t + 0.36, 784, 0.4, "sine", 0.2);
      break;
    case "correct":
      tone(ac, t, 784, 0.12, "sine", 0.22);
      tone(ac, t + 0.1, 1175, 0.22, "sine", 0.22);
      break;
    case "wrong":
      tone(ac, t, 220, 0.25, "square", 0.08);
      break;
    case "notify":
      tone(ac, t, 988, 0.15, "sine", 0.15);
      break;
  }
}

/** Pick the right sound for a move given chess.js move flags. */
export function soundForMove(m: { flags: string; san: string }): SoundKind {
  if (m.san.includes("#")) return "end";
  if (m.san.includes("+")) return "check";
  if (m.flags.includes("p")) return "promote";
  if (m.flags.includes("k") || m.flags.includes("q")) return "castle";
  if (m.flags.includes("c") || m.flags.includes("e")) return "capture";
  return "move";
}
