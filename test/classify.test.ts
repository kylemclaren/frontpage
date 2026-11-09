import { afterEach, beforeEach, expect, test } from "bun:test"

process.env.FRONTPAGE_DB = ":memory:" // keep tests off the dev database
process.env.TYPESAFE_API_KEY = "test-key"
const { combine, judge, profileQuestions } = await import("../server/classify")
type Profile = import("../server/classify").Profile
type HNItem = import("../server/hn").HNItem

const story = (id: number, title: string): HNItem => ({ id, type: "story", time: 0, title })
const rust = { id: "rust", label: "Rust", description: "async runtimes and compilers" }
const postgres = { id: "postgres", label: "Postgres", description: "Postgres" }
const crypto = { id: "crypto", label: "Crypto", description: "price talk", avoid: true }

/** A fake scoring API: answers 0.9 when the story title mentions the topic's first word, else 0.1. */
let requests: { questions: number }[] = []
let release: (() => void) | undefined
const realFetch = globalThis.fetch
beforeEach(() => {
  requests = []
  release = undefined
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      questions: Record<string, { instructions: { topic?: string; story: { title: string } } }>
    }
    requests.push({ questions: Object.keys(body.questions).length })
    if (release === undefined) await Promise.resolve()
    else await new Promise<void>((r) => (release = r))
    const answers = Object.fromEntries(
      Object.entries(body.questions).map(([k, q]) => {
        const word = (q.instructions.topic ?? "liked").split(/\W/)[0]!.toLowerCase()
        return [k, { type: "noul", noul: q.instructions.story.title.toLowerCase().includes(word) ? 0.9 : 0.1 }]
      }),
    )
    return Response.json({ model: "test", answers, usage: { input_tokens: 10, output_tokens: 0 } })
  }) as unknown as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})

const asked = () => requests.reduce((n, r) => n + r.questions, 0)

test("question keys depend on the wording, not on the reader or the interest's id", () => {
  const a = profileQuestions({ interests: [rust, crypto], liked: [] })
  const b = profileQuestions({ interests: [{ ...rust, id: "other-id" }, postgres], liked: [] })
  expect(a[0]!.key).toBe(b[0]!.key)
  expect(a[0]!.key).not.toBe(a[1]!.key)
  // The same wording as a skip topic is a different question.
  expect(profileQuestions({ interests: [{ ...rust, avoid: true }], liked: [] })[0]!.key).not.toBe(a[0]!.key)
})

test("combine: best interest drives the score, taste adds 20%, a skip topic pulls it down", () => {
  const wantsOnly = profileQuestions({ interests: [rust, postgres], liked: [] })
  const j = combine(
    wantsOnly,
    new Map([
      [wantsOnly[0]!.key, 0.9],
      [wantsOnly[1]!.key, 0.2],
    ]),
  )
  expect(j.relevance).toBeCloseTo(0.9)
  expect(j.best).toBe("rust")
  expect(j.taste).toBeUndefined()

  const withTaste = profileQuestions({ interests: [rust], liked: [{ id: 1, title: "x" }] })
  const t = combine(
    withTaste,
    new Map([
      [withTaste[0]!.key, 1],
      [withTaste[1]!.key, 0.5],
    ]),
  )
  expect(t.relevance).toBeCloseTo(0.8 * 1 + 0.2 * 0.5)

  const withSkip = profileQuestions({ interests: [rust, crypto], liked: [] })
  const s = combine(
    withSkip,
    new Map([
      [withSkip[0]!.key, 0.8],
      [withSkip[1]!.key, 0.75],
    ]),
  )
  expect(s.relevance).toBeCloseTo(0.8 * 0.25)
  expect(s.skip).toBe("crypto")

  const skipOnly = profileQuestions({ interests: [crypto], liked: [] })
  expect(combine(skipOnly, new Map([[skipOnly[0]!.key, 0]])).relevance).toBe(1)
})

test("judge caches each answer: a repeat is free, and a new interest only asks its own questions", async () => {
  const stories = [story(101, "Rust 2.0 released"), story(102, "Postgres 19 internals")]
  const first: Profile = { interests: [rust], liked: [] }

  const scored = new Map<number, number>()
  const r1 = await judge(stories, first, { onScored: (id, j) => scored.set(id, j.relevance) })
  expect(r1.asked).toBe(2)
  expect(scored.get(101)).toBeCloseTo(0.9)
  expect(scored.get(102)).toBeCloseTo(0.1)

  // Same profile again: everything comes from the cache, reported up front.
  let cachedCount = 0
  const r2 = await judge(stories, first, {
    onCached: (m, pending) => ((cachedCount = m.size), expect(pending).toBe(0)),
  })
  expect(r2.asked).toBe(0)
  expect(cachedCount).toBe(2)

  // A different reader who shares "Rust" and adds "Postgres": only the Postgres questions are new.
  const before = asked()
  const r3 = await judge(stories, { interests: [{ ...rust, id: "r" }, postgres], liked: [] })
  expect(r3.asked).toBe(2)
  expect(asked() - before).toBe(2)

  // Removing an interest asks nothing.
  expect((await judge(stories, { interests: [postgres], liked: [] })).asked).toBe(0)
})

test("judge: two overlapping requests for the same answers pay once", async () => {
  release = () => {}
  const stories = [story(201, "Rust on embedded")]
  const p: Profile = { interests: [rust], liked: [] }
  const a = judge(stories, p)
  const b = judge(stories, p)
  await Bun.sleep(20)
  release()
  const [ra, rb] = await Promise.all([a, b])
  expect(ra.asked + rb.asked).toBe(1)
  expect(asked()).toBe(1)
})

test("judge: stories past the question budget are left unscored", async () => {
  const stories = [story(301, "a"), story(302, "b"), story(303, "c")]
  const scored: number[] = []
  const r = await judge(
    stories,
    { interests: [rust, postgres], liked: [] },
    { maxQuestions: 4, onScored: (id) => scored.push(id) },
  )
  expect(r.asked).toBe(4)
  expect(r.skipped).toBe(1)
  expect(scored.toSorted()).toEqual([301, 302])
})
