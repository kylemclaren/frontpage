/**
 * The Jev questions. The reader's profile (interests + titles they liked on HN)
 * is the shared state. Each question quotes the one story it judges, so
 * answers don't smear between neighbouring stories in a batch.
 */
import { createHash } from "node:crypto"
import { getJudgments, putJudgments, recordUsage } from "./db"
import { siteOf, stripHtml, type HNItem, type SavedStory } from "./hn"
import { ask, chunkGroups, MODEL, type JevResponse, type Question } from "./jev"
import type { Interest } from "./topics"

/** Bump when question wording changes so cached judgments are not reused. */
export const QUESTION_VERSION = 4
/** How many liked titles (favorites, then submissions) go into the state as examples of the reader's taste. */
export const TASTE_SAMPLE = 40
/** With explicit interests, liked HN stories are only a hint, so fewer of them go in. */
export const TASTE_SAMPLE_WITH_INTERESTS = 12
/**
 * Share of the score that comes from the best-matching explicit interest
 * (from Ask your AI or typed in). The rest is Jev's overall "would they open
 * it?" judgment, which is where HN favorites and submissions have a say.
 */
export const INTEREST_WEIGHT = 0.8
const NONE = "none"

export interface Profile {
  interests: Interest[]
  liked: SavedStory[]
}

export interface Judgment {
  /** 0..1, what the feed sorts and filters by. */
  relevance: number
  /** P(the reader would want to open this story), from the whole profile. */
  fit: number
  /** P(the story is about the best-matching interest): the max of `interests`. */
  match: number
  /** P(the story is mainly about one of the reader's skip topics). */
  avoid: number
  /** P(the story is mainly about this interest), one yes/no question per interest. */
  interests: Record<string, number>
  best?: string
  /** The skip topic it most likely falls under, when avoid is high. */
  skip?: string
}

const wants = (p: Profile) => p.interests.filter((i) => !i.avoid)
const skips = (p: Profile) => p.interests.filter((i) => i.avoid)
const describe = (i: Interest) =>
  i.description && i.description !== i.label ? `${i.label}: ${i.description}` : i.label
const tasteSample = (p: Profile) => p.liked.slice(0, wants(p).length ? TASTE_SAMPLE_WITH_INTERESTS : TASTE_SAMPLE)

export const isEmpty = (p: Profile) => p.interests.length === 0 && p.liked.length === 0

export function profileHash(p: Profile): string {
  const key = JSON.stringify({
    v: QUESTION_VERSION,
    m: MODEL,
    i: p.interests.map((i) => [i.id, i.label, i.description, i.avoid ? 1 : 0]),
    l: tasteSample(p).map((s) => s.id),
  })
  return createHash("sha256").update(key).digest("hex").slice(0, 16)
}

export function profileState(p: Profile) {
  const w = wants(p)
  const k = skips(p)
  const liked = tasteSample(p).map((s) => (s.site ? `${s.title} (${s.site})` : s.title))
  return {
    about:
      "A Hacker News reader's profile. Each question quotes one Hacker News story and asks how well that story fits this reader.",
    ...(w.length ? { interests: w.map(describe) } : {}),
    ...(k.length ? { not_interested_in: k.map(describe) } : {}),
    ...(liked.length
      ? w.length
        ? {
            weak_hint_stories_they_liked: liked,
            note: "`interests` is what the reader told us they want and matters most. `weak_hint_stories_they_liked` are older HN favorites and submissions: only a weak hint.",
          }
        : { stories_they_liked: liked }
      : {}),
  }
}

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

export function storyQuestions(s: HNItem, p: Profile): Record<string, Question> {
  const story = storyQuote(s)
  const w = wants(p)
  const k = skips(p)
  const questions: Record<string, Question> = {}

  if (w.length || p.liked.length) {
    const basis = w.length ? "`interests` first and foremost" : "`stories_they_liked`"
    questions[`s${s.id}_fit`] = {
      type: "noul",
      instructions: {
        task: `Judging by this reader's ${basis}, would they want to open the quoted Hacker News story? Judge only the quoted story.`,
        story,
      },
      criteria: {
        true: "The story is squarely about something this reader cares about",
        false:
          "The story is about something else, something they want to avoid, or touches their interests only in passing",
      },
    }
  }
  // One narrow yes/no per interest. A single choice across all interests spreads
  // probability thin, so an unrelated story could still look like a partial match.
  w.forEach((interest, j) => {
    questions[`s${s.id}_i${j}`] = {
      type: "noul",
      instructions: {
        task: "Is the quoted Hacker News story mainly about this topic the reader cares about? A passing mention or a loose connection does not count. Judge only the quoted story.",
        topic: describe(interest),
        story,
      },
      criteria: {
        true: "The story is clearly about this topic; someone who follows the topic would want to see it",
        false: "The story is about something else, or only touches the topic in passing",
      },
    }
  })
  if (k.length) {
    const criteria: Record<string, string> = {}
    for (const i of k) criteria[i.id] = describe(i)
    criteria[NONE] = "None of these: the story is not mainly about any of them"
    questions[`s${s.id}_skip`] = {
      type: "choice",
      instructions: {
        task: "The reader asked to filter out the topics below. Is the quoted story mainly about one of them? A passing mention does not count. Judge only the quoted story.",
        story,
      },
      criteria,
    }
  }
  return questions
}

const notNone = (a: JevResponse["answers"][string] | undefined) =>
  1 - (a?.probabilities?.[NONE] ?? (a?.choice === NONE ? 1 : 0))

export function parseJudgment(s: HNItem, p: Profile, res: JevResponse): Judgment {
  const w = wants(p)
  const k = skips(p)
  const skipAns = res.answers[`s${s.id}_skip`]

  const interests: Record<string, number> = {}
  let match = 0
  let best: string | undefined
  w.forEach((interest, j) => {
    const v = res.answers[`s${s.id}_i${j}`]?.noul ?? 0
    interests[interest.id] = v
    if (v > match) {
      match = v
      best = interest.id
    }
  })

  const hasFit = w.length > 0 || p.liked.length > 0
  const fit = hasFit ? (res.answers[`s${s.id}_fit`]?.noul ?? 0) : 1
  const avoid = k.length ? notNone(skipAns) : 0
  // Explicit interests dominate; the overall judgment (which also sees HN history) fills in the rest.
  // With only liked stories, fit is all we have. With only skip topics, everything starts at 1.
  const base = w.length ? INTEREST_WEIGHT * match + (1 - INTEREST_WEIGHT) * fit : fit
  return {
    relevance: base * (1 - avoid),
    fit,
    match: w.length ? match : fit,
    avoid,
    interests,
    best: match >= 0.5 ? best : undefined,
    skip: skipAns?.choice && skipAns.choice !== NONE ? skipAns.choice : undefined,
  }
}

export interface JudgeResult {
  judgments: Map<number, Judgment>
  fresh: number
  /** Uncached stories left unscored because of `maxFresh`. */
  skipped: number
  inputTokens: number
  errors: string[]
}

/** Judge stories against the profile, reusing cached judgments. At most `maxFresh` uncached stories go to Jev. */
export async function judge(stories: HNItem[], p: Profile, { maxFresh = Infinity } = {}): Promise<JudgeResult> {
  const judgments = new Map<number, Judgment>()
  const result: JudgeResult = { judgments, fresh: 0, skipped: 0, inputTokens: 0, errors: [] }
  if (isEmpty(p)) return result

  const hash = profileHash(p)
  const cached = await getJudgments(
    stories.map((s) => s.id),
    hash,
  )
  const uncached: HNItem[] = []
  for (const s of stories) {
    const json = cached.get(s.id)
    if (json) judgments.set(s.id, JSON.parse(json) as Judgment)
    else uncached.push(s)
  }
  const todo = uncached.slice(0, Math.max(0, maxFresh))
  result.skipped = uncached.length - todo.length

  const state = profileState(p)
  const perStory = todo[0] ? Object.keys(storyQuestions(todo[0], p)).length : 1
  await Promise.all(
    chunkGroups(todo, perStory).map(async (batch) => {
      const questions = Object.assign({}, ...batch.map((s) => storyQuestions(s, p))) as Record<string, Question>
      try {
        const res = await ask(state, questions)
        const tokens = res.usage?.input_tokens ?? 0
        result.inputTokens += tokens
        recordUsage(tokens)
        const rows = batch.map((s) => {
          const j = parseJudgment(s, p, res)
          judgments.set(s.id, j)
          return { storyId: s.id, profileHash: hash, json: JSON.stringify(j) }
        })
        result.fresh += batch.length
        await putJudgments(rows)
      } catch (err) {
        result.errors.push((err as Error).message)
      }
    }),
  )
  return result
}
