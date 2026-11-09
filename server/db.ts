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

/** Cached answers older than this are deleted: stories leave HN's lists long before. */
const SCORE_TTL_MS = 14 * 24 * 60 * 60_000
const PRUNE_EVERY_MS = 6 * 60 * 60_000

/** Creates tables on first use; every query awaits this. */
export const ready: Promise<void> = (async () => {
  // One row per answer: P(yes) for one story and one question (see classify.ts for how keys are made).
  await sql`
    CREATE TABLE IF NOT EXISTS scores (
      story_id BIGINT NOT NULL,
      question_key TEXT NOT NULL,
      value DOUBLE PRECISION NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (story_id, question_key)
    )`
  await sql`
    CREATE TABLE IF NOT EXISTS usage (
      day TEXT PRIMARY KEY,
      input_tokens BIGINT NOT NULL,
      requests BIGINT NOT NULL
    )`
})()

/** Cached answers for these stories and questions: story id → question key → P(yes). */
export async function getScores(storyIds: number[], questionKeys: string[]): Promise<Map<number, Map<string, number>>> {
  await ready
  const out = new Map<number, Map<string, number>>()
  if (!storyIds.length || !questionKeys.length) return out
  const rows: { story_id: number | bigint | string; question_key: string; value: number | string }[] = await sql`
    SELECT story_id, question_key, value FROM scores
    WHERE story_id IN ${sql(storyIds)} AND question_key IN ${sql(questionKeys)}`
  for (const r of rows) {
    const id = Number(r.story_id)
    let answers = out.get(id)
    if (!answers) out.set(id, (answers = new Map()))
    answers.set(r.question_key, Number(r.value))
  }
  return out
}

let lastPrune = 0

export async function putScores(rows: { storyId: number; key: string; value: number }[]) {
  await ready
  if (!rows.length) return
  const now = Date.now()
  const values = rows.map((r) => ({ story_id: r.storyId, question_key: r.key, value: r.value, created_at: now }))
  await sql`
    INSERT INTO scores ${sql(values)}
    ON CONFLICT (story_id, question_key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`
  if (now - lastPrune > PRUNE_EVERY_MS) {
    lastPrune = now
    sql`DELETE FROM scores WHERE created_at < ${now - SCORE_TTL_MS}`.catch((err: Error) =>
      console.error("score prune failed:", err.message),
    )
  }
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
