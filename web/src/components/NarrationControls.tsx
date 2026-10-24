"use client";

import { Mic, MicOff, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { setNarration, speak, speechSupported, useNarration, useVoices } from "@/lib/narrator";

/** Narrator on/off, plus voice and speed settings. Renders nothing where the browser can't speak. */
export function NarrationControls() {
  const s = useNarration();
  const voices = useVoices();
  const [open, setOpen] = useState(false);
  const [supported, setSupported] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setSupported(speechSupported()), []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (!supported) return null;

  return (
    <div ref={box} className="relative flex items-center gap-1">
      <button
        onClick={() => setNarration({ on: !s.on })}
        role="switch"
        aria-checked={s.on}
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-bold ${s.on ? "bg-brand/25 text-brand-light" : "bg-panel2 text-muted hover:text-white"}`}
        title={s.on ? "Narrator on" : "Narrator off"}
      >
        {s.on ? <Mic size={16} /> : <MicOff size={16} />} Narrator
      </button>
      <button onClick={() => setOpen((o) => !o)} aria-label="Narrator settings" aria-expanded={open} className="rounded-md bg-panel2 p-1.5 text-muted hover:text-white">
        <Settings2 size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-line bg-[#1f1e1b] p-4 shadow-2xl">
          <label className="mb-1 block text-xs font-bold uppercase text-muted" htmlFor="narrator-voice">
            Voice
          </label>
          <select
            id="narrator-voice"
            className="input mb-3 w-full py-1.5 text-sm"
            value={s.voiceURI ?? ""}
            onChange={(e) => setNarration({ voiceURI: e.target.value || null })}
          >
            <option value="">Best available{voices[0] ? ` (${voices[0].name})` : ""}</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name}
              </option>
            ))}
          </select>
          <label className="mb-1 flex justify-between text-xs font-bold uppercase text-muted" htmlFor="narrator-rate">
            Speed <span className="tabular-nums">{s.rate.toFixed(2)}×</span>
          </label>
          <input id="narrator-rate" type="range" min={0.7} max={1.3} step={0.05} value={s.rate} onChange={(e) => setNarration({ rate: +e.target.value })} className="mb-3 w-full accent-[#81b64c]" />
          <label className="mb-1 flex justify-between text-xs font-bold uppercase text-muted" htmlFor="narrator-pitch">
            Depth <span>{s.pitch <= 0.8 ? "deep" : s.pitch >= 1 ? "natural" : "a little deep"}</span>
          </label>
          <input
            id="narrator-pitch"
            type="range"
            min={0.6}
            max={1.1}
            step={0.05}
            // Slider right = deeper.
            value={1.7 - s.pitch}
            onChange={(e) => setNarration({ pitch: Math.round((1.7 - +e.target.value) * 100) / 100 })}
            className="mb-3 w-full accent-[#81b64c]"
          />
          <button
            className="btn-secondary w-full justify-center"
            onClick={() => speak("Every great game starts with a plan. Let's learn yours, one move at a time. Nf3, then d4.", { ...s, on: true })}
          >
            Test the voice
          </button>
          <p className="mt-2 text-[11px] leading-snug text-muted">
            Voices come from your browser. Microsoft Edge&apos;s &quot;Natural&quot; voices sound the most human.
          </p>
        </div>
      )}
    </div>
  );
}
