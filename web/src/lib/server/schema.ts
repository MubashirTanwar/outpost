/** The database schema; db/schema.sql is the same text, to paste into a SQL editor (a test keeps them equal). */
export const SCHEMA = `
create table if not exists reviews (
  game_id    text primary key,
  white      text not null,
  black      text not null,
  end_time   bigint not null default 0,
  review     jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists reviews_white on reviews (lower(white), end_time desc);
create index if not exists reviews_black on reviews (lower(black), end_time desc);

create table if not exists pasted_games (
  game_id    text primary key,
  meta       jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists puzzles (
  username   text not null,
  id         text not null,
  puzzle     jsonb not null,
  attempt    jsonb,
  created_at timestamptz not null default now(),
  primary key (username, id)
);

create table if not exists progress (
  username   text primary key,
  progress   jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists day_overviews (
  username   text not null,
  day        text not null,
  overview   jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (username, day)
);

-- Row-level security on, with no policies: the app's server connects as the database owner and isn't
-- affected, but Supabase's public REST/GraphQL APIs (anon key) can't read or write these tables.
alter table reviews enable row level security;
alter table pasted_games enable row level security;
alter table puzzles enable row level security;
alter table progress enable row level security;
alter table day_overviews enable row level security;
`;
