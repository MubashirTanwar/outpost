"use client";

/**
 * Course progress store: localStorage on this device, synced to the backend knowledge graph
 * (per chess.com username) when a backend is available, so progress follows you across devices.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { API_URL, getHealth } from "./api";
import { COURSES, lineIds } from "./courses";
import { checkAchievements, emptyProgress, mergeProgress, type Achievement, type Progress } from "./progress";

const KEY = "cc-progress";
const USER_KEY = "cc-username";

let state: Progress = emptyProgress();
let loaded = false;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const achievementListeners = new Set<(a: Achievement[]) => void>();

function user(): string | null {
  try {
    return localStorage.getItem(USER_KEY);
  } catch {
    return null;
  }
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...emptyProgress(), ...JSON.parse(raw) };
  } catch {}
  void pullFromServer();
}

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void pushToServer(), 1500);
}

async function pullFromServer() {
  const u = user();
  if (!u || !(await getHealth())) return;
  try {
    const res = await fetch(`${API_URL}/api/players/${encodeURIComponent(u)}/progress`);
    if (!res.ok) return;
    const { progress } = (await res.json()) as { progress: Progress | null };
    if (progress) {
      state = mergeProgress(state, progress);
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch {}
      emit();
    }
  } catch {}
}

async function pushToServer() {
  const u = user();
  if (!u || !(await getHealth())) return;
  try {
    await fetch(`${API_URL}/api/players/${encodeURIComponent(u)}/progress`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
  } catch {}
}

const COURSE_LINES = COURSES.map((c) => ({ id: c.id, lineIds: lineIds(c) }));

/** Apply an update, check achievements, persist and notify. Returns newly unlocked achievements. */
export function updateProgress(fn: (p: Progress) => Progress): Achievement[] {
  load();
  const next = fn(state);
  const { progress, unlocked } = checkAchievements(next, COURSE_LINES, Date.now());
  state = progress;
  persist();
  emit();
  if (unlocked.length) achievementListeners.forEach((l) => l(unlocked));
  return unlocked;
}

function subscribe(l: () => void) {
  load();
  listeners.add(l);
  return () => listeners.delete(l);
}

const serverSnapshot = emptyProgress();

function snapshot(): Progress {
  load();
  return state;
}

export function useProgress(): Progress {
  return useSyncExternalStore(subscribe, snapshot, () => serverSnapshot);
}

/** False during server rendering and hydration; true once this device's progress is loaded. */
export function useProgressReady(): boolean {
  return useSyncExternalStore(subscribe, () => (load(), true), () => false);
}

export function useAchievementToasts(onUnlock: (a: Achievement[]) => void) {
  const cb = useCallback(onUnlock, [onUnlock]);
  useEffect(() => {
    achievementListeners.add(cb);
    return () => {
      achievementListeners.delete(cb);
    };
  }, [cb]);
}

/** Re-render periodically so "due" badges appear without a reload. */
export function useNow(intervalMs = 60_000): number {
  const subscribeTick = useCallback(
    (l: () => void) => {
      const t = setInterval(l, intervalMs);
      return () => clearInterval(t);
    },
    [intervalMs],
  );
  return useSyncExternalStore(subscribeTick, () => Math.floor(Date.now() / intervalMs) * intervalMs, () => 0);
}
