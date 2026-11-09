export type Mode = "bubble" | "filter" | "hn"
export type List = "top" | "new" | "best" | "ask" | "show"

export interface Interest {
  id: string
  label: string
  description: string
  avoid?: boolean
}

export interface Judgment {
  relevance: number
  fit: number
  match: number
  avoid: number
  interests: Record<string, number>
  best?: string
  skip?: string
}

export interface Story {
  id: number
  rank: number
  title: string
  url: string
  site?: string
  by?: string
  time: number
  score: number
  comments: number
  /** In the reader's HN favorites or submissions (set in the browser, from its HN import). */
  upvoted?: boolean
  judgment: Judgment | null
}

export interface Feed {
  list: List
  profileEmpty: boolean
  errors: string[]
  stats: { stories: number; judgedNow: number; unscored: number; inputTokens: number; costUsd: number; ms: number }
  stories: Story[]
}

export interface Profile {
  interests: Interest[]
  hnUser: string | null
  liked: { count: number; bySource: Record<string, number> }
  scoringConfigured: boolean
}

export async function api<T>(path: string, init?: Omit<RequestInit, "body"> & { body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
  return data as T
}

/** localStorage that never throws (private windows, blocked storage). */
export const prefs = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(`frontpage:${key}`)
      return v == null ? fallback : (JSON.parse(v) as T)
    } catch {
      return fallback
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(`frontpage:${key}`, JSON.stringify(value))
    } catch {
      // ignore
    }
  },
}

export function timeAgo(unixSeconds: number) {
  const s = Date.now() / 1000 - unixSeconds
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
