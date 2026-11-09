/**
 * TypeSafe / Jev client. Jev answers typed questions about a shared `state`:
 *   noul   → P(yes), 0..1
 *   choice → one id from `criteria`, plus a probability for every id
 *   score  → an index into an ordered list of levels
 * Docs: https://docs.typesafe.ai
 */

export const API_URL = "https://api.typesafe.ai/v1/systemone"
export const MODEL = process.env.JEV_MODEL || "jev-latest"
/** USD per input token; output tokens are free. */
export const PRICE_PER_INPUT_TOKEN = 0.042 / 1_000_000

/** Every question in one request shares the state and runs in parallel. 64 tested fine (~0.3s). */
export const MAX_QUESTIONS_PER_REQUEST = 64
/** TypeSafe allows ~20 req/s; stay well under it. */
const MAX_IN_FLIGHT = 8

export interface Answer {
  type: "noul" | "choice" | "score"
  noul?: number
  choice?: string
  score?: number
  probabilities?: Record<string, number>
  confidence?: number
}

export interface JevResponse {
  model: string
  answers: Record<string, Answer>
  usage?: { input_tokens: number; output_tokens: number }
}

export type Question =
  | { type: "noul"; instructions: unknown; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: unknown; criteria: Record<string, string> }
  | { type: "score"; instructions: unknown; criteria: string[] }

export class JevError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

export const hasApiKey = () => Boolean(process.env.TYPESAFE_API_KEY)

let inFlight = 0
const waiting: (() => void)[] = []
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiting.push(r))
  inFlight++
  try {
    return await fn()
  } finally {
    inFlight--
    waiting.shift()?.()
  }
}

export function ask(
  state: unknown,
  questions: Record<string, Question>,
  { timeoutMs = 20_000, retries = 4 } = {},
): Promise<JevResponse> {
  const apiKey = process.env.TYPESAFE_API_KEY
  if (!apiKey) return Promise.reject(new JevError("Set TYPESAFE_API_KEY in .env.local", 401))
  const body = JSON.stringify({ model: MODEL, state, questions })

  return slot(async () => {
    let lastError: JevError | undefined
    let retryAfterMs = 0
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        const base = lastError?.status === 429 || lastError?.status === 529 ? 1000 : 300
        const backoff = Math.min(15_000, base * 2 ** (attempt - 1)) + Math.random() * 250
        await Bun.sleep(Math.max(backoff, retryAfterMs))
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(API_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body,
          signal: controller.signal,
        })
        if (res.ok) return (await res.json()) as JevResponse
        const text = await res.text().catch(() => "")
        lastError = new JevError(`TypeSafe ${res.status}: ${text.slice(0, 300)}`, res.status)
        retryAfterMs = Number(res.headers.get("retry-after") ?? 0) * 1000 || 0
        // Only rate limits, overload and server errors improve with a retry.
        if (res.status < 500 && res.status !== 429 && res.status !== 408) break
      } catch (err) {
        lastError = new JevError(controller.signal.aborted ? "TypeSafe timed out" : (err as Error).message)
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastError ?? new JevError("TypeSafe call failed")
  })
}

/** Split a question map into request-sized groups without separating a group's keys. */
export function chunkGroups<T>(groups: T[], perGroup: number, max = MAX_QUESTIONS_PER_REQUEST): T[][] {
  const size = Math.max(1, Math.floor(max / Math.max(1, perGroup)))
  const out: T[][] = []
  for (let i = 0; i < groups.length; i += size) out.push(groups.slice(i, i + size))
  return out
}
