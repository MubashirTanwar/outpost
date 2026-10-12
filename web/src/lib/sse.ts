/** Minimal server-sent-events parsing for the coach stream (data-only events, JSON payloads). */

/** Split a buffer into complete events; returns the parsed events and the unfinished tail. */
export function parseSSE(buffer: string): { events: unknown[]; rest: string } {
  const chunks = buffer.split(/\r?\n\r?\n/);
  const rest = chunks.pop() ?? "";
  const events: unknown[] = [];
  for (const chunk of chunks) {
    const data = chunk
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      // ignore a malformed event rather than dropping the whole stream
    }
  }
  return { events, rest };
}

/** POST and call `onEvent` for each event as it arrives. Resolves when the stream ends. */
export async function postSSE(url: string, body: unknown, onEvent: (e: unknown) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) throw new Error(`Stream failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const parsed = parseSSE(buffer + decoder.decode(value, { stream: true }));
    buffer = parsed.rest;
    parsed.events.forEach(onEvent);
  }
  parseSSE(buffer + "\n\n").events.forEach(onEvent);
}
