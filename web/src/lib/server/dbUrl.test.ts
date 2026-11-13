import assert from "node:assert/strict";
import { test } from "node:test";
import { databaseConfig } from "./dbUrl.ts";

test("DATABASE_URL first, then the integrations' POSTGRES_URL", () => {
  assert.equal(databaseConfig({}), null);
  assert.equal(databaseConfig({ DATABASE_URL: "postgres://a@h:5432/d", POSTGRES_URL: "postgres://b@h/d" })!.url, "postgres://a@h:5432/d");
  assert.equal(databaseConfig({ POSTGRES_URL: "postgres://b@h/d" })!.url, "postgres://b@h/d");
});

test("Supabase integration URL: extra params dropped, TLS required", () => {
  const c = databaseConfig({ POSTGRES_URL: "postgres://postgres.ref:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x" })!;
  assert.equal(c.url, "postgres://postgres.ref:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres");
  assert.equal(c.ssl, "require");
  assert.equal(databaseConfig({ DATABASE_URL: "postgres://u:p@db.ref.supabase.co:5432/postgres" })!.ssl, "require");
});

test("local databases without TLS; sslmode=disable respected", () => {
  assert.equal(databaseConfig({ DATABASE_URL: "postgres://postgres@127.0.0.1:5433/postgres" })!.ssl, false);
  assert.equal(databaseConfig({ DATABASE_URL: "postgres://u@db.example.com/x?sslmode=disable" })!.ssl, false);
  assert.equal(databaseConfig({ DATABASE_URL: "postgres://u@db.example.com/x" })!.ssl, undefined);
});
