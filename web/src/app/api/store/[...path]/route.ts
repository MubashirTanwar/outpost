import { NextResponse, type NextRequest } from "next/server";
import { db, dbEnabled } from "@/lib/server/db";

/**
 * The app's storage API, backed by Postgres (see lib/server/db.ts):
 *
 *   GET        health                                   connects; { enabled, connected, error? }
 *   GET/PUT    reviews/:gameId
 *   GET/PUT    pasted/:gameId
 *   GET        players/:user/reviews?days=365[&full=1]   summaries, or whole reviews
 *   GET/POST   players/:user/puzzles                     POST body: { puzzles: [...] } (adds new; a newer attempt wins)
 *   POST       players/:user/puzzles/:id/attempt         body: { solved }
 *   GET/PUT    players/:user/progress
 *   GET/PUT    players/:user/days/:day
 *
 * No accounts: data is keyed by chess.com username, like the rest of the app.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const USER = /^[A-Za-z0-9_-]{1,50}$/;
const ID = /^[A-Za-z0-9_:.-]{1,120}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY = 4_000_000;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const bad = (msg: string, status = 400) => json({ error: msg }, status);

async function body<T>(req: NextRequest): Promise<T | null> {
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

type Ctx = { params: { path: string[] } };

async function handle(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const p = params.path;
  const method = req.method;
  if (p[0] === "health") {
    // Connects (creating the tables on first use), so this answers "is the database reachable?".
    if (!dbEnabled()) return json({ enabled: false, connected: false });
    try {
      const sql = await db();
      await sql`select 1`;
      return json({ enabled: true, connected: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ enabled: false, connected: false, error: msg.replace(/postgres(ql)?:\/\/[^\s]+/g, "postgres://…") });
    }
  }
  if (!dbEnabled()) return bad("storage is not configured", 503);
  const sql = await db();

  // reviews/:gameId and pasted/:gameId
  if ((p[0] === "reviews" || p[0] === "pasted") && p.length === 2) {
    const id = p[1];
    if (!ID.test(id)) return bad("bad game id");
    if (p[0] === "reviews") {
      if (method === "GET") {
        const [row] = await sql`select review from reviews where game_id = ${id}`;
        return json({ review: row?.review ?? null });
      }
      if (method === "PUT") {
        const review = await body<{ game?: { id?: string; white?: string; black?: string; end_time?: number } }>(req);
        const g = review?.game;
        if (!g || g.id !== id || !g.white || !g.black) return bad("expected a review with its game");
        await sql`
          insert into reviews (game_id, white, black, end_time, review)
          values (${id}, ${g.white}, ${g.black}, ${Math.floor(g.end_time ?? 0)}, ${sql.json(review as never)})
          on conflict (game_id) do update set review = excluded.review, end_time = excluded.end_time, updated_at = now()`;
        return json({ ok: true });
      }
    } else {
      if (method === "GET") {
        const [row] = await sql`select meta from pasted_games where game_id = ${id}`;
        return json({ meta: row?.meta ?? null });
      }
      if (method === "PUT") {
        const meta = await body<{ id?: string; pgn?: string }>(req);
        if (!meta || meta.id !== id || typeof meta.pgn !== "string") return bad("expected a pasted game");
        await sql`insert into pasted_games (game_id, meta) values (${id}, ${sql.json(meta as never)})
                  on conflict (game_id) do update set meta = excluded.meta`;
        return json({ ok: true });
      }
    }
    return bad("method not allowed", 405);
  }

  // players/:user/...
  if (p[0] === "players" && p.length >= 3) {
    if (!USER.test(p[1])) return bad("bad username");
    const user = p[1].toLowerCase();
    const what = p[2];

    if (what === "reviews" && p.length === 3 && method === "GET") {
      const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days") ?? 365) || 365, 1), 3650);
      const since = Math.floor(Date.now() / 1000) - days * 86400;
      const full = req.nextUrl.searchParams.get("full") === "1";
      const rows = full
        ? await sql`select review from reviews where (lower(white) = ${user} or lower(black) = ${user}) and end_time >= ${since} order by end_time desc limit 1000`
        : await sql`select jsonb_build_object('game', review->'game', 'summary', review->'summary') as review
                    from reviews where (lower(white) = ${user} or lower(black) = ${user}) and end_time >= ${since} order by end_time desc limit 5000`;
      return json({ reviews: rows.map((r) => r.review) });
    }

    if (what === "puzzles") {
      if (p.length === 3 && method === "GET") {
        const rows = await sql`select puzzle, attempt from puzzles where username = ${user} order by created_at`;
        return json({ puzzles: rows.map((r) => ({ ...r.puzzle, attempt: r.attempt ?? null })) });
      }
      if (p.length === 3 && method === "POST") {
        const b = await body<{ puzzles?: { id?: string }[] }>(req);
        const list = (b?.puzzles ?? []).filter((x) => x && typeof x.id === "string" && ID.test(x.id)).slice(0, 500);
        for (const pz of list) {
          const { attempt, ...puzzle } = pz as { id: string; attempt?: unknown };
          await sql`insert into puzzles (username, id, puzzle, attempt) values (${user}, ${puzzle.id}, ${sql.json(puzzle as never)}, nullif(${sql.json((attempt ?? null) as never)}::jsonb, 'null'::jsonb))
                    on conflict (username, id) do update set attempt = excluded.attempt
                    where excluded.attempt is not null
                      and (puzzles.attempt is null or (excluded.attempt->>'last_at')::float > coalesce((puzzles.attempt->>'last_at')::float, 0))`;
        }
        return json({ ok: true, added: list.length });
      }
      if (p.length === 5 && p[4] === "attempt" && method === "POST") {
        if (!ID.test(p[3])) return bad("bad puzzle id");
        const b = await body<{ solved?: boolean }>(req);
        if (typeof b?.solved !== "boolean") return bad("expected { solved }");
        const [row] = await sql`select attempt from puzzles where username = ${user} and id = ${p[3]}`;
        if (!row) return bad("no such puzzle", 404);
        const prev = (row.attempt as { attempts: number; streak: number } | null) ?? { attempts: 0, streak: 0 };
        const attempt = { attempts: prev.attempts + 1, streak: b.solved ? prev.streak + 1 : 0, solved: b.solved, last_at: Date.now() / 1000 };
        await sql`update puzzles set attempt = ${sql.json(attempt)} where username = ${user} and id = ${p[3]}`;
        return json({ attempt });
      }
    }

    if (what === "progress" && p.length === 3) {
      if (method === "GET") {
        const [row] = await sql`select progress from progress where username = ${user}`;
        return json({ progress: row?.progress ?? null });
      }
      if (method === "PUT") {
        const progress = await body<{ lines?: unknown }>(req);
        if (!progress || typeof progress !== "object" || (progress.lines !== undefined && typeof progress.lines !== "object")) return bad("expected progress");
        await sql`insert into progress (username, progress) values (${user}, ${sql.json(progress as never)})
                  on conflict (username) do update set progress = excluded.progress, updated_at = now()`;
        return json({ ok: true });
      }
    }

    if (what === "days" && p.length === 4) {
      if (!DAY.test(p[3])) return bad("bad day");
      if (method === "GET") {
        const [row] = await sql`select overview from day_overviews where username = ${user} and day = ${p[3]}`;
        return json({ overview: row?.overview ?? null });
      }
      if (method === "PUT") {
        const overview = await body<object>(req);
        if (!overview) return bad("expected an overview");
        await sql`insert into day_overviews (username, day, overview) values (${user}, ${p[3]}, ${sql.json(overview as never)})
                  on conflict (username, day) do update set overview = excluded.overview, updated_at = now()`;
        return json({ ok: true });
      }
    }
  }
  return bad("not found", 404);
}

async function safe(req: NextRequest, ctx: Ctx) {
  try {
    return await handle(req, ctx);
  } catch (e) {
    console.error("store:", e);
    return bad("storage error", 500);
  }
}

export { safe as GET, safe as PUT, safe as POST };
