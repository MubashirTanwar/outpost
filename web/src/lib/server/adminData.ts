import "server-only";
import { reviewStats } from "@/lib/reviewStats";
import type { Review } from "@/lib/types";
import { db } from "./db";

/* Accuracy / Game Rating / result of the reviewing player, read from the stats column. */
const MY = (field: string) => `(stats -> (stats->>'player_color') ->> '${field}')`;
const ACC = `${MY("accuracy")}::float`;
const GR = `${MY("game_rating")}::float`;
const RATING = `${MY("rating")}::float`;
const RESULT = `${MY("result")}`;

/** Fill in stats for reviews saved before they existed. A batch at a time, so pages stay quick. */
export async function backfillStats(limit = 300): Promise<number> {
  const sql = await db();
  const rows = await sql`select game_id, review from reviews where stats is null limit ${limit}`;
  for (const r of rows) {
    let stats = null;
    try {
      stats = reviewStats(r.review as Review);
    } catch {}
    // An unreadable review gets an empty object so it isn't retried forever.
    await sql`update reviews set stats = ${sql.json((stats ?? {}) as never)}, player = ${stats?.player ?? null} where game_id = ${r.game_id}`;
  }
  return rows.length;
}

/** Everyone the app knows: reviewers, plus anyone with progress, puzzles or a reviewed day. */
const PLAYERS = `
  select player as username from reviews where player is not null
  union select username from progress
  union select username from puzzles
  union select username from day_overviews`;

export async function overview() {
  const sql = await db();
  await backfillStats();
  const [totals] = await sql.unsafe(`
    select
      (select count(*) from (${PLAYERS}) p)::int as players,
      (select count(*) from reviews)::int as reviews,
      (select count(*) from reviews where created_at > now() - interval '1 day')::int as reviews_24h,
      (select count(*) from reviews where created_at > now() - interval '7 days')::int as reviews_7d,
      (select count(*) from pasted_games)::int as pasted,
      (select count(*) from puzzles)::int as puzzles,
      (select coalesce(sum((attempt->>'attempts')::int), 0) from puzzles where attempt is not null)::int as attempts,
      (select count(*) from puzzles where (attempt->>'solved')::bool)::int as solved,
      (select count(*) from day_overviews)::int as days,
      (select coalesce(sum((progress->>'xp')::int), 0) from progress)::int as xp,
      (select round(avg(${ACC})::numeric, 1) from reviews where stats ? 'white')::float as avg_accuracy,
      (select pg_size_pretty(pg_database_size(current_database()))) as db_size`);
  const [active] = await sql.unsafe(`
    with activity as (
      select player as username, created_at as at from reviews where player is not null
      union all select username, updated_at from progress
      union all select username, updated_at from day_overviews
      union all select username, to_timestamp((attempt->>'last_at')::float) from puzzles where attempt is not null)
    select count(distinct username) filter (where at > now() - interval '1 day')::int as d1,
           count(distinct username) filter (where at > now() - interval '7 days')::int as d7,
           count(distinct username) filter (where at > now() - interval '30 days')::int as d30
    from activity`);
  const perDay = await sql.unsafe(`
    with days as (select generate_series(current_date - 29, current_date, interval '1 day')::date as day)
    select to_char(d.day, 'YYYY-MM-DD') as day,
           (select count(*) from reviews where created_at::date = d.day)::int as reviews,
           (select count(distinct player) from reviews where created_at::date = d.day)::int as players
    from days d order by d.day`);
  const timeClasses = await sql.unsafe(`
    select coalesce(nullif(stats->>'time_class', ''), 'other') as time_class, count(*)::int as games, round(avg(${ACC})::numeric, 1)::float as accuracy
    from reviews where stats ? 'white' group by 1 order by 2 desc`);
  const openings = await sql.unsafe(`
    select stats->>'opening' as opening, count(*)::int as games, round(avg(${ACC})::numeric, 1)::float as accuracy
    from reviews where stats->>'opening' is not null group by 1 order by 2 desc limit 8`);
  return {
    totals: totals as Record<string, number | string | null>,
    active: active as unknown as { d1: number; d7: number; d30: number },
    perDay: perDay as unknown as { day: string; reviews: number; players: number }[],
    timeClasses: timeClasses as unknown as { time_class: string; games: number; accuracy: number | null }[],
    openings: openings as unknown as { opening: string; games: number; accuracy: number | null }[],
  };
}

export type Activity = { at: string; kind: "review" | "day" | "progress" | "puzzle" | "pasted"; username: string | null; ref: string; detail: Record<string, unknown> };

/** Everything that happened, newest first. `before` pages back (an ISO timestamp). */
export async function history(opts: { before?: string; kind?: string; username?: string; limit?: number } = {}): Promise<Activity[]> {
  const sql = await db();
  const before = opts.before && !Number.isNaN(Date.parse(opts.before)) ? opts.before : new Date(Date.now() + 60_000).toISOString();
  const user = opts.username?.toLowerCase() ?? null;
  const kind = opts.kind ?? null;
  const rows = await sql`
    select * from (
      select created_at as at, 'review' as kind, player as username, game_id as ref,
             jsonb_build_object('white', white, 'black', black, 'stats', stats) as detail from reviews
      union all select updated_at, 'day', username, day, jsonb_build_object('games', overview->'games') from day_overviews
      union all select updated_at, 'progress', username, username, jsonb_build_object('xp', progress->'xp') from progress
      union all select to_timestamp((attempt->>'last_at')::float), 'puzzle', username, id,
             jsonb_build_object('solved', attempt->'solved', 'attempts', attempt->'attempts', 'theme', puzzle->'theme') from puzzles where attempt is not null
      union all select created_at, 'pasted', null, game_id, jsonb_build_object('white', meta->'white', 'black', meta->'black') from pasted_games
    ) a
    where at < ${before}
      and (${kind}::text is null or kind = ${kind})
      and (${user}::text is null or lower(username) = ${user})
    order by at desc limit ${Math.min(opts.limit ?? 50, 200)}`;
  return rows.map((r) => ({ ...r, at: new Date(r.at).toISOString() })) as unknown as Activity[];
}

export type PlayerRow = {
  username: string;
  games: number;
  accuracy: number | null;
  game_rating: number | null;
  rating: number | null;
  wins: number;
  blunders_per_game: number | null;
  xp: number;
  puzzles: number;
  solved: number;
  days: number;
  last_active: string | null;
};

const SORTS: Record<string, string> = {
  games: "games desc",
  accuracy: "accuracy desc nulls last",
  game_rating: "game_rating desc nulls last",
  rating: "rating desc nulls last",
  xp: "xp desc",
  puzzles: "solved desc",
  active: "last_active desc nulls last",
};

export async function players(opts: { sort?: string; q?: string; limit?: number } = {}): Promise<PlayerRow[]> {
  const sql = await db();
  await backfillStats();
  const order = SORTS[opts.sort ?? "active"] ?? SORTS.active;
  const q = opts.q ? `%${opts.q.toLowerCase().replace(/[%_]/g, "")}%` : null;
  const rows = await sql.unsafe(
    `
    with p as (${PLAYERS}),
    g as (
      select player as username, count(*)::int as games, round(avg(${ACC})::numeric, 1)::float as accuracy,
             round(avg(${GR}))::int as game_rating,
             (array_agg(${RATING} order by end_time desc) filter (where ${RATING} is not null))[1]::int as rating,
             count(*) filter (where ${RESULT} = 'win')::int as wins,
             round(avg((stats -> (stats->>'player_color') ->> 'blunders')::float)::numeric, 2)::float as blunders_per_game,
             max(created_at) as last_review
      from reviews where player is not null and stats ? 'white' group by player),
    z as (
      select username, count(*)::int as puzzles, count(*) filter (where (attempt->>'solved')::bool)::int as solved,
             max(to_timestamp((attempt->>'last_at')::float)) as last_puzzle
      from puzzles group by username),
    d as (select username, count(*)::int as days, max(updated_at) as last_day from day_overviews group by username)
    select p.username, coalesce(g.games, 0) as games, g.accuracy, g.game_rating, g.rating, coalesce(g.wins, 0) as wins,
           g.blunders_per_game, coalesce((pr.progress->>'xp')::int, 0) as xp,
           coalesce(z.puzzles, 0) as puzzles, coalesce(z.solved, 0) as solved, coalesce(d.days, 0) as days,
           greatest(g.last_review, pr.updated_at, z.last_puzzle, d.last_day) as last_active
    from p left join g using (username) left join z using (username) left join d using (username)
    left join progress pr on pr.username = p.username
    where $1::text is null or p.username like $1
    order by ${order}, p.username limit ${Math.min(opts.limit ?? 200, 1000)}`,
    [q],
  );
  return rows.map((r) => ({ ...r, last_active: r.last_active ? new Date(r.last_active).toISOString() : null })) as unknown as PlayerRow[];
}

export async function player(username: string) {
  const sql = await db();
  const user = username.toLowerCase();
  await backfillStats();
  const [row] = await players({ q: user, limit: 50 }).then((rs) => rs.filter((r) => r.username === user));
  const games = await sql`
    select game_id, end_time, created_at, white, black, stats from reviews
    where player = ${user} or lower(white) = ${user} or lower(black) = ${user}
    order by end_time desc limit 300`;
  const puzzlesByTheme = await sql`
    select coalesce(puzzle->>'theme', 'other') as theme, count(*)::int as puzzles,
           count(*) filter (where (attempt->>'solved')::bool)::int as solved
    from puzzles where username = ${user} group by 1 order by 2 desc`;
  const [prog] = await sql`select progress, updated_at from progress where username = ${user}`;
  const days = await sql`select day, overview->'summary'->'avg_accuracy' as accuracy, overview->'games' as games, updated_at
                         from day_overviews where username = ${user} order by day desc limit 60`;
  return {
    summary: row ?? null,
    games: games.map((g) => ({ ...g, created_at: new Date(g.created_at).toISOString() })) as unknown as {
      game_id: string; end_time: number; created_at: string; white: string; black: string; stats: import("@/lib/reviewStats").ReviewStats | null;
    }[],
    puzzlesByTheme: puzzlesByTheme as unknown as { theme: string; puzzles: number; solved: number }[],
    progress: (prog?.progress ?? null) as import("@/lib/progress").Progress | null,
    progressUpdated: prog?.updated_at ? new Date(prog.updated_at).toISOString() : null,
    days: days as unknown as { day: string; accuracy: number | null; games: number; updated_at: Date }[],
  };
}

export type RecordRow = { username: string | null; value: number; game_id?: string; detail?: string; at?: string };

/** The leaderboards and one-offs worth bragging about. */
export async function records(): Promise<Record<string, RecordRow[]>> {
  const sql = await db();
  await backfillStats();
  const q = (text: string) => sql.unsafe(text) as unknown as Promise<RecordRow[]>;
  const OPP = `(stats -> (case when stats->>'player_color' = 'white' then 'black' else 'white' end) ->> 'name')`;
  const [accuracy, overperf, brilliant, blunder, longest, mostGames, xp, solved, streak] = await Promise.all([
    q(`select player as username, ${ACC} as value, game_id, 'vs ' || ${OPP} as detail from reviews
       where ${ACC} is not null and (stats->>'plies')::int >= 30 order by value desc limit 10`),
    q(`select player as username, (${GR} - ${RATING}) as value, game_id,
              'played like ' || (${GR})::int || ', rated ' || (${RATING})::int as detail from reviews
       where ${GR} is not null and ${RATING} is not null and (stats->>'plies')::int >= 30 order by value desc limit 10`),
    q(`select player as username, (stats -> (stats->>'player_color') ->> 'brilliant')::int as value, game_id, 'vs ' || ${OPP} as detail
       from reviews where (stats -> (stats->>'player_color') ->> 'brilliant')::int > 0 order by value desc, end_time desc limit 10`),
    q(`select (stats -> (stats->'worst'->>'color') ->> 'name') as username, (stats->'worst'->>'win_loss')::float as value, game_id,
              'move ' || ((stats->'worst'->>'ply')::int / 2 + 1) || ': ' || (stats->'worst'->>'san') || ' vs ' ||
              (stats -> (case when stats->'worst'->>'color' = 'white' then 'black' else 'white' end) ->> 'name') as detail
       from reviews where stats ? 'worst' and stats->'worst' <> 'null' order by value desc limit 10`),
    q(`select player as username, (stats->>'plies')::int as value, game_id, 'vs ' || ${OPP} as detail
       from reviews where stats ? 'plies' order by value desc limit 10`),
    q(`select player as username, count(*)::int as value from reviews where player is not null group by player order by value desc limit 10`),
    q(`select username, (progress->>'xp')::int as value from progress order by value desc nulls last limit 10`),
    q(`select username, count(*)::int as value from puzzles where (attempt->>'solved')::bool group by username order by value desc limit 10`),
    // Longest run of consecutive days with XP, from each player's progress.days.
    q(`with d as (select username, (jsonb_object_keys(progress->'days'))::date as day from progress where jsonb_typeof(progress->'days') = 'object'),
            g as (select username, day, day - (row_number() over (partition by username order by day))::int as grp from d)
       select username, max(n)::int as value from (select username, grp, count(*) as n from g group by username, grp) s
       group by username order by value desc limit 10`),
  ]);
  return { accuracy, overperf, brilliant, blunder, longest, mostGames, xp, solved, streak };
}
