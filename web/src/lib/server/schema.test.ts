import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SCHEMA } from "./schema.ts";

test("db/schema.sql matches the schema the API creates", () => {
  const file = readFileSync(new URL("../../../db/schema.sql", import.meta.url), "utf8");
  assert.equal(file.trim(), SCHEMA.trim());
});

test("every table has row-level security on", () => {
  const tables = [...SCHEMA.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]);
  for (const t of tables) assert.match(SCHEMA, new RegExp(`alter table ${t} enable row level security`));
});
