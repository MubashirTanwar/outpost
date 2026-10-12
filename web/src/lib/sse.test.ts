import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSSE } from "./sse.ts";

test("complete events are parsed and the tail is kept for the next chunk", () => {
  const { events, rest } = parseSSE('data: {"type":"delta","text":"Hi"}\n\ndata: {"type":"del');
  assert.deepEqual(events, [{ type: "delta", text: "Hi" }]);
  assert.equal(rest, 'data: {"type":"del');
  const next = parseSSE(rest + 'ta","text":" there"}\n\n');
  assert.deepEqual(next.events, [{ type: "delta", text: " there" }]);
  assert.equal(next.rest, "");
});

test("CRLF line endings, comments and bad JSON don't break the stream", () => {
  const { events } = parseSSE(': keepalive\r\n\r\ndata: nope\r\n\r\ndata: {"type":"done"}\r\n\r\n');
  assert.deepEqual(events, [{ type: "done" }]);
});
