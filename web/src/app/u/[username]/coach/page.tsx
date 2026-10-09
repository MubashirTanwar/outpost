"use client";

import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Kittu } from "@/components/Kittu";
import { Markdown } from "@/components/Markdown";
import { api, getHealth } from "@/lib/api";

interface Msg {
  role: "user" | "assistant";
  content: string;
  meta?: string;
}

const STARTERS = [
  "What are my biggest weaknesses?",
  "Which openings should I learn for my style?",
  "How do I stop hanging pieces?",
  "Build me a 7-day training plan.",
];

export default function CoachPage({ params }: { params: { username: string } }) {
  const username = decodeURIComponent(params.username);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [fen, setFen] = useState("");
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getHealth().then((h) => setAvailable(!!h));
  }, []);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [messages]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setBusy(true);
    try {
      const res = await api.chat({ username, message: text, fen: fen.trim() || null, history });
      setMessages((m) => [...m, { role: "assistant", content: res.answer, meta: `${res.source} · used ${res.used.join(", ") || "nothing"}` }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: `Something went wrong: ${e instanceof Error ? e.message : e}` }]);
    } finally {
      setBusy(false);
    }
  };

  if (available === false)
    return (
      <div className="mx-auto max-w-xl p-8">
        <div className="card p-6">
          <h2 className="text-xl font-extrabold">The coach needs the backend</h2>
          <p className="mt-2 text-soft">
            The AI coach runs as a LangGraph agent next to Stockfish and your Neo4j game graph. Start it with{" "}
            <code className="rounded bg-panel2 px-1.5">docker compose up</code> and set <code className="rounded bg-panel2 px-1.5">NEXT_PUBLIC_API_URL</code>.
          </p>
        </div>
      </div>
    );

  return (
    <div className="mx-auto flex h-[calc(100vh-56px)] max-w-3xl flex-col p-3 md:h-screen md:p-5">
      <h1 className="mb-3 text-2xl font-extrabold">Coach Kittu</h1>
      <div className="card flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="py-8 text-center">
            <div className="mx-auto w-fit">
              <Kittu mood="smug" size={110} />
            </div>
            <p className="mt-1 font-extrabold italic">“Ask me anything. I already know the answer.”</p>
            <p className="mt-2 text-soft">Ask about your games, your weaknesses, openings, or paste a FEN and ask about a position.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {STARTERS.map((s) => (
                <button key={s} className="btn-secondary" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}>
            {m.role === "assistant" && (
              <div className="shrink-0">
                <Kittu mood={i === messages.length - 1 ? "smug" : "neutral"} size={44} />
              </div>
            )}
            <div className={`max-w-[85%] rounded-lg px-4 py-3 ${m.role === "user" ? "bg-[#4b4847]" : "bg-panel2"}`}>
              {m.role === "assistant" ? <Markdown>{m.content}</Markdown> : <p>{m.content}</p>}
              {m.meta && <p className="mt-1 text-[11px] text-muted">{m.meta}</p>}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Kittu mood="thinking" size={36} /> Kittu is thinking…
          </div>
        )}
        <div ref={bottom} />
      </div>
      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input className="input w-full text-sm" placeholder="Optional: paste a FEN to ask about a position" value={fen} onChange={(e) => setFen(e.target.value)} />
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="Ask Kittu…" value={input} onChange={(e) => setInput(e.target.value)} />
          <button className="btn-primary px-4" disabled={busy || !input.trim()} aria-label="Send">
            <Send size={20} />
          </button>
        </div>
      </form>
    </div>
  );
}
