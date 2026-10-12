"use client";

import { useCallback, useState } from "react";
import type { Achievement } from "@/lib/progress";
import { playSound } from "@/lib/sounds";
import { useAchievementToasts } from "@/lib/useProgress";

export function AchievementToasts() {
  const [toasts, setToasts] = useState<(Achievement & { key: number })[]>([]);
  const onUnlock = useCallback((list: Achievement[]) => {
    playSound("end");
    const stamped = list.map((a, i) => ({ ...a, key: Date.now() + i }));
    setToasts((t) => [...t, ...stamped]);
    setTimeout(() => setToasts((t) => t.filter((x) => !stamped.some((s) => s.key === x.key))), 4500);
  }, []);
  useAchievementToasts(onUnlock);

  return (
    <div className="pointer-events-none fixed bottom-[calc(72px+env(safe-area-inset-bottom))] right-4 z-50 md:bottom-4 flex flex-col gap-2">
      {toasts.map((a) => (
        <div key={a.key} className="animate-pop flex items-center gap-3 rounded-xl bg-[#f7c631] px-4 py-3 text-[#2b2210] shadow-xl">
          <span className="text-3xl">{a.icon}</span>
          <div>
            <div className="text-xs font-extrabold uppercase">Achievement unlocked</div>
            <div className="font-extrabold">{a.title}</div>
            <div className="text-xs">{a.text}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
