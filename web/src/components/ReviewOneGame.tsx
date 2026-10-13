"use client";

import { Link2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { locateGame } from "@/lib/client";
import { parseGameInput } from "@/lib/gamelink";

/** Paste a chess.com game link, game number or PGN and open its review. */
export function ReviewOneGame({ username }: { username: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (value: string) => {
    const input = parseGameInput(value);
    if (!input) {
      setError("Paste a chess.com game link (…chess.com/game/live/123456789), its number, or a PGN.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      router.push(await locateGame(username, input));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <form
      className="card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(text);
      }}
    >
      <label htmlFor="one-game" className="mb-2 flex items-center gap-2 font-extrabold">
        <Link2 size={18} className="text-brand-light" /> Review one game
      </label>
      <div className="flex gap-2">
        {/* A textarea so a multi-line PGN pastes intact; Enter submits a link. */}
        <textarea
          id="one-game"
          rows={1}
          className="input min-h-[42px] flex-1 resize-none py-2 text-sm"
          placeholder="Paste a chess.com game link, game number or PGN"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onPaste={(e) => {
            // A pasted link starts right away; a PGN too, since nobody types one by hand.
            const pasted = e.clipboardData.getData("text");
            if (parseGameInput(pasted)) {
              e.preventDefault();
              setText(pasted);
              void submit(pasted);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit(text);
            }
          }}
        />
        <button className="btn-primary shrink-0 px-4" disabled={busy || !text.trim()}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : "Review"}
        </button>
      </div>
      {busy && <p className="mt-2 text-xs text-muted">Looking for the game in {username}&apos;s chess.com games…</p>}
      {error && <p className="mt-2 text-sm text-[#ff8a7a]">{error}</p>}
    </form>
  );
}
