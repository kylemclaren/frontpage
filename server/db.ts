/**
 * Shared caches. Production uses Fly Managed Postgres (DATABASE_URL); local dev
 * falls back to a SQLite file. Bun.SQL speaks both with the same queries.
 * Nothing here is per-reader: profiles live in each browser.
 */
import { SQL } from "bun"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

function connect(): SQL {
  if (process.env.DATABASE_URL) return new SQL(process.env.DATABASE_URL)
  const path = process.env.FRONTPAGE_DB || "data/frontpage.sqlite"
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true })
  return new SQL(`sqlite://${path}`)
}

export const sql = connect()
export const dialect = process.env.DATABASE_URL ? "postgres" : "sqlite"

/** Creates tables on first use; every query awaits this. */
export const ready: Promise<void> = (async () => {
  await sql`
    CREATE TABLE IF NOT EXISTS judgments (
      story_id BIGINT NOT NULL,
      profile_hash TEXT NOT NULL,
      json TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (story_id, profile_hash)
    )`
  await sql`
    CREATE TABLE IF NOT EXISTS usage (
      day TEXT PRIMARY KEY,
      input_tokens BIGINT NOT NULL,
      requests BIGINT NOT NULL
    )`
})()

/** Cached judgments (as JSON strings) for these stories under one profile. */
export async function getJudgments(storyIds: number[], profileHash: string): Promise<Map<number, string>> {
  await ready
  if (!storyIds.length) return new Map()
  const rows: { story_id: number | bigint; json: string }[] =
    await sql`SELECT story_id, json FROM judgments WHERE profile_hash = ${profileHash} AND story_id IN ${sql(storyIds)}`
  return new Map(rows.map((r) => [Number(r.story_id), r.json]))
}

export async function putJudgments(rows: { storyId: number; profileHash: string; json: string }[]) {
  await ready
  if (!rows.length) return
  const now = Date.now()
  const values = rows.map((r) => ({ story_id: r.storyId, profile_hash: r.profileHash, json: r.json, created_at: now }))
  await sql`
    INSERT INTO judgments ${sql(values)}
    ON CONFLICT (story_id, profile_hash) DO UPDATE SET json = excluded.json, created_at = excluded.created_at`
}

/** Daily token tally, for keeping an eye on spend. Never blocks a request. */
export function recordUsage(inputTokens: number) {
  const day = new Date().toISOString().slice(0, 10)
  ready
    .then(
      () => sql`
        INSERT INTO usage (day, input_tokens, requests) VALUES (${day}, ${inputTokens}, 1)
        ON CONFLICT (day) DO UPDATE SET
          input_tokens = usage.input_tokens + excluded.input_tokens,
          requests = usage.requests + 1`,
    )
    .catch((err) => console.error("usage tally failed:", (err as Error).message))
}
