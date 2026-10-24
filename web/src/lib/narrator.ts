"use client";

/** The lesson narrator: browser speech synthesis with saved settings shared across the app. */
import { useEffect, useState, useSyncExternalStore } from "react";
import { rankVoices, readingTime, sentences, spokenText } from "./narration";

export interface NarrationSettings {
  on: boolean;
  voiceURI: string | null; // null = the best narrator voice available
  rate: number;
  pitch: number;
}

const KEY = "cc-narration";
// Calm and a little deep, like a documentary narrator.
export const DEFAULT_NARRATION: NarrationSettings = { on: false, voiceURI: null, rate: 0.95, pitch: 0.85 };

let settings: NarrationSettings = DEFAULT_NARRATION;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) settings = { ...DEFAULT_NARRATION, ...JSON.parse(raw) };
  } catch {}
}

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function setNarration(patch: Partial<NarrationSettings>) {
  load();
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
  if (patch.on === false) stopSpeaking();
  listeners.forEach((l) => l());
}

/** The saved narration settings; components re-render when they change anywhere. */
export function useNarration(): NarrationSettings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => {
      load();
      return settings;
    },
    () => DEFAULT_NARRATION,
  );
}

/** English voices, best narrator first (voices load asynchronously in most browsers). */
export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!speechSupported()) return;
    const update = () => setVoices(rankVoices(window.speechSynthesis.getVoices()));
    update();
    window.speechSynthesis.addEventListener("voiceschanged", update);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);
  return voices;
}

let generation = 0;
let current: Promise<void> = Promise.resolve();

/** Resolves when the narrator has finished what it's saying (straight away if it's quiet). */
export function speechIdle(): Promise<void> {
  return current;
}

export function stopSpeaking() {
  generation++;
  if (speechSupported()) window.speechSynthesis.cancel();
}

/**
 * Say `text` (chess notation is read as words). Resolves when it has been spoken, or straight
 * away if it's interrupted by another call or stopSpeaking(). Sentence by sentence, because some
 * browsers silently stop a single long utterance after about 15 seconds.
 */
export function speak(text: string, s: NarrationSettings = settings): Promise<void> {
  if (!speechSupported() || !text.trim()) return Promise.resolve();
  const synth = window.speechSynthesis;
  const gen = ++generation;
  synth.cancel();
  const voices = synth.getVoices();
  const voice = voices.find((v) => v.voiceURI === s.voiceURI) ?? rankVoices(voices)[0] ?? null;
  const parts = sentences(spokenText(text));
  current = new Promise((resolve) => {
    let i = 0;
    const next = () => {
      if (gen !== generation || i >= parts.length) return resolve();
      const part = parts[i++];
      const u = new SpeechSynthesisUtterance(part);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      u.rate = s.rate;
      u.pitch = s.pitch;
      let finished = false;
      // If the browser never reports the end (it happens), move on anyway.
      const guard = setTimeout(() => done(), readingTime(part, s.rate) * 2 + 3000);
      const done = () => {
        if (finished) return;
        finished = true;
        clearTimeout(guard);
        next();
      };
      u.onend = done;
      u.onerror = done;
      synth.speak(u);
    };
    next();
  });
  return current;
}
