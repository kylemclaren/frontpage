/**
 * Scoring. Every score is the answer to one narrow yes/no question about one
 * story: "is it mainly about <this interest>?", "is it mainly about <this skip
 * topic>?", or "would someone who liked <these stories> open it?".
 *
 * Each answer is cached on its own, keyed by the story and the question's
 * wording, never by the reader. So readers who share an interest share its
 * answers, and editing one interest only asks the questions that are new.
 * A reader's relevance score is computed from those answers on every request.
 */
import { createHash } from "node:crypto"
import { getScores, putScores, recordUsage } from "./db"
import { siteOf, stripHtml, type HNItem, type SavedStory } from "./hn"
import { ask, MAX_QUESTIONS_PER_REQUEST, MODEL, type Question } from "./jev"
import type { Interest } from "./topics"

/** Bump when question wording changes so cached answers are not reused. */
export const QUESTION_VERSION = 5
/** How many liked titles (favorites, then submissions) the taste question sees. */
export const TASTE_SAMPLE = 40
/** With explicit interests, liked HN stories are only a hint, so fewer of them go in. */
export const TASTE_SAMPLE_WITH_INTERESTS = 12
/**
 * Share of the score that comes from the best-matching explicit interest when
 * the reader also has an HN import. The rest is the taste answer. With no HN
 * import, the best interest match is the whole score.
 */
export const INTEREST_WEIGHT = 0.8

export interface Profile {
  interests: Interest[]
  liked: SavedStory[]
}

export interface Judgment {
  /** 0..1, what the feed sorts and filters by. */
  relevance: number
  /** P(the story is about the best-matching interest): the max of `interests`. */
  match: number
  /** P(the story is mainly about one of the reader's skip topics): the max over skip topics. */
  avoid: number
  /** P(a reader who liked the imported HN stories would open this one). Absent with no HN import. */
  taste?: number
  /** P(the story is mainly about this interest), one yes/no question per interest. */
  interests: Record<string, number>
  best?: string
  /** The skip topic it most likely falls under, when avoid is high. */
  skip?: string
}

type StoryQuote = ReturnType<typeof storyQuote>

/** One cacheable question, asked of every story. `key` identifies its wording, not the reader. */
export interface ProfileQuestion {
  kind: "want" | "skip" | "taste"
  key: string
  /** The interest or skip topic this is about (absent for taste). */
  interestId?: string
  /** Shared state the question needs. Questions with the same state object are batched together. */
  state: unknown
  build: (story: StoryQuote) => Question
}

const describe = (i: Interest) =>
  i.description && i.description !== i.label ? `${i.label}: ${i.description}` : i.label

export const isEmpty = (p: Profile) => p.interests.length === 0 && p.liked.length === 0

function questionKey(kind: ProfileQuestion["kind"], text: string) {
  return createHash("sha256")
    .update(JSON.stringify([QUESTION_VERSION, MODEL, kind, text]))
    .digest("hex")
    .slice(0, 20)
}

/** Shared by every interest and skip question. It says nothing about the reader, so answers are reusable. */
const TOPIC_STATE = { about: "Each question quotes one Hacker News story and names one topic." }

export function storyQuote(s: HNItem) {
  const site = siteOf(s.url)
  const text = s.text ? stripHtml(s.text).slice(0, 600) : ""
  const kind = /^Ask HN\b/i.test(s.title ?? "")
    ? "Ask HN"
    : /^Show HN\b/i.test(s.title ?? "")
      ? "Show HN"
      : s.type === "job"
        ? "Job posting"
        : undefined
  return { title: s.title, ...(site ? { site } : {}), ...(kind ? { kind } : {}), ...(text ? { text } : {}) }
}

function wantQuestion(interest: Interest): ProfileQuestion {
  const topic = describe(interest)
  return {
    kind: "want",
    key: questionKey("want", topic),
    interestId: interest.id,
    state: TOPIC_STATE,
    build: (story) => ({
      type: "noul",
      instructions: {
        task: "Is the quoted Hacker News story mainly about this topic? A passing mention or a loose connection does not count. Judge only the quoted story.",
        topic,
        story,
      },
      criteria: {
        true: "The story is clearly about this topic; someone who follows the topic would want to see it",
        false: "The story is about something else, or only touches the topic in passing",
      },
    }),
  }
}

function skipQuestion(interest: Interest): ProfileQuestion {
  const topic = describe(interest)
  return {
    kind: "skip",
    key: questionKey("skip", topic),
    interestId: interest.id,
    state: TOPIC_STATE,
    build: (story) => ({
      type: "noul",
      instructions: {
        task: "A reader wants to filter out stories about this topic. Is the quoted Hacker News story mainly about it? A passing mention does not count. Judge only the quoted story.",
        topic,
        story,
      },
      criteria: {
        true: "The story is mainly about this topic",
        false: "The story is about something else, or only mentions the topic in passing",
      },
    }),
  }
}

function tasteQuestion(liked: SavedStory[]): ProfileQuestion {
  return {
    kind: "taste",
    key: questionKey("taste", liked.map((s) => s.id).join(",")),
    state: {
      about: "Stories a Hacker News reader favorited or submitted. Each question quotes one other story.",
      stories_they_liked: liked.map((s) => (s.site ? `${s.title} (${s.site})` : s.title)),
    },
    build: (story) => ({
      type: "noul",
      instructions: {
        task: "Judging by `stories_they_liked`, would this reader want to open the quoted Hacker News story? Judge only the quoted story.",
        story,
      },
      criteria: {
        true: "The story is very like the ones they liked, in topic and kind",
        false: "The story is about something else",
      },
    }),
  }
}

/** The questions this profile needs answered for each story. */
export function profileQuestions(p: Profile): ProfileQuestion[] {
  const out = p.interests.map((i) => (i.avoid ? skipQuestion(i) : wantQuestion(i)))
  const hasWants = p.interests.some((i) => !i.avoid)
  const liked = p.liked.slice(0, hasWants ? TASTE_SAMPLE_WITH_INTERESTS : TASTE_SAMPLE)
  if (liked.length) out.push(tasteQuestion(liked))
  return out
}

/** Combine one story's answers (question key → probability) into the reader's judgment. */
export function combine(questions: ProfileQuestion[], answers: Map<string, number>): Judgment {
  const interests: Record<string, number> = {}
  let match = 0
  let best: string | undefined
  let avoid = 0
  let skip: string | undefined
  let taste: number | undefined
  let hasWants = false

  for (const q of questions) {
    const v = answers.get(q.key) ?? 0
    if (q.kind === "want") {
      hasWants = true
      interests[q.interestId!] = v
      if (v > match) {
        match = v
        best = q.interestId
      }
    } else if (q.kind === "skip") {
      if (v > avoid) {
        avoid = v
        skip = q.interestId
      }
    } else {
      taste = v
    }
  }

  // Explicit interests dominate; an HN import adds a light taste signal.
  // With only an import, taste is the score. With only skip topics, everything starts at 1.
  const base = hasWants
    ? taste === undefined
      ? match
      : INTEREST_WEIGHT * match + (1 - INTEREST_WEIGHT) * taste
    : (taste ?? 1)
  return {
    relevance: base * (1 - avoid),
    match: hasWants ? match : (taste ?? 0),
    avoid,
    ...(taste === undefined ? {} : { taste }),
    interests,
    best: match >= 0.5 ? best : undefined,
    skip: avoid >= 0.5 ? skip : undefined,
  }
}

export interface JudgeResult {
  /** Questions sent for scoring by this call. */
  asked: number
  /** Stories this call sent at least one new question for. */
  fresh: number
  /** Stories left unscored because `maxQuestions` ran out. */
  skipped: number
  inputTokens: number
  errors: string[]
}

export interface JudgeOptions {
  /** Upper bound on new questions this call may send. */
  maxQuestions?: number
  /** Called once, as soon as the cache has been read: the judgments already known, and how many stories are still being scored. */
  onCached?: (judgments: Map<number, Judgment>, pending: number) => void
  /** Called for each remaining story as soon as its last answer arrives. */
  onScored?: (storyId: number, judgment: Judgment) => void
}

/**
 * Answers being fetched right now, by "storyId:questionKey". A second request
 * that needs the same answer waits for the first instead of paying again.
 */
const inFlight = new Map<string, Promise<number | undefined>>()

interface Pending {
  story: HNItem
  q: ProfileQuestion
  resolve: (value: number | undefined) => void
}

/** Send one request-sized batch, store its answers, then hand them to whoever is waiting. */
async function askBatch(state: unknown, batch: Pending[], result: JudgeResult) {
  try {
    const res = await ask(state, Object.fromEntries(batch.map((b, n) => [`q${n}`, b.q.build(storyQuote(b.story))])))
    const tokens = res.usage?.input_tokens ?? 0
    result.inputTokens += tokens
    recordUsage(tokens)
    const values = batch.map((_, n) => res.answers[`q${n}`]?.noul)
    const rows = batch.flatMap((b, n) => {
      const value = values[n]
      return value === undefined ? [] : [{ storyId: b.story.id, key: b.q.key, value }]
    })
    await putScores(rows).catch((err) => console.error("score cache write failed:", (err as Error).message))
    batch.forEach((b, n) => b.resolve(values[n]))
  } catch (err) {
    result.errors.push((err as Error).message)
    for (const b of batch) b.resolve(undefined)
  }
}

/** Judge stories against the profile. Cached answers are reported at once; the rest arrive through `onScored`. */
export async function judge(stories: HNItem[], p: Profile, options: JudgeOptions = {}): Promise<JudgeResult> {
  const { maxQuestions = Infinity, onCached, onScored } = options
  const result: JudgeResult = { asked: 0, fresh: 0, skipped: 0, inputTokens: 0, errors: [] }
  const questions = profileQuestions(p)
  if (!questions.length || !stories.length) {
    onCached?.(new Map(), 0)
    return result
  }

  // Two interests with identical wording share one question.
  const unique = [...new Map(questions.map((q) => [q.key, q])).values()]
  const cached = await getScores(
    stories.map((s) => s.id),
    unique.map((q) => q.key),
  )

  const ready = new Map<number, Judgment>()
  /** Stories waiting on answers: what is known so far, plus a promise for each missing answer. */
  const waiting: { story: HNItem; answers: Map<string, number>; rest: [string, Promise<number | undefined>][] }[] = []
  /** New questions to send, grouped by the state they share. */
  const toAsk = new Map<unknown, Pending[]>()
  let budget = Math.max(0, maxQuestions)

  for (const story of stories) {
    const answers = cached.get(story.id) ?? new Map<string, number>()
    const missing = unique.filter((q) => !answers.has(q.key))
    if (!missing.length) {
      ready.set(story.id, combine(questions, answers))
      continue
    }
    const fresh = missing.filter((q) => !inFlight.has(`${story.id}:${q.key}`))
    if (fresh.length > budget) {
      result.skipped++
      continue
    }
    budget -= fresh.length
    result.asked += fresh.length
    if (fresh.length) result.fresh++

    const rest: [string, Promise<number | undefined>][] = []
    for (const q of missing) {
      const flightKey = `${story.id}:${q.key}`
      let promise = inFlight.get(flightKey)
      if (!promise) {
        const created = Promise.withResolvers<number | undefined>()
        promise = created.promise
        inFlight.set(flightKey, promise)
        void promise.finally(() => inFlight.delete(flightKey))
        const group = toAsk.get(q.state) ?? []
        group.push({ story, q, resolve: created.resolve })
        toAsk.set(q.state, group)
      }
      rest.push([q.key, promise])
    }
    waiting.push({ story, answers, rest })
  }

  onCached?.(ready, waiting.length)

  const batches: Promise<void>[] = []
  for (const [state, group] of toAsk) {
    for (let i = 0; i < group.length; i += MAX_QUESTIONS_PER_REQUEST) {
      batches.push(askBatch(state, group.slice(i, i + MAX_QUESTIONS_PER_REQUEST), result))
    }
  }

  // Report each story the moment its last answer lands. A story with a failed answer stays unscored.
  await Promise.all(
    waiting.map(async ({ story, answers, rest }) => {
      const values = await Promise.all(rest.map(([, promise]) => promise))
      if (values.includes(undefined)) return
      rest.forEach(([key], n) => answers.set(key, values[n]!))
      onScored?.(story.id, combine(questions, answers))
    }),
  )
  await Promise.all(batches)
  return result
}
