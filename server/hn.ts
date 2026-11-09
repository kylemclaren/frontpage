/**
 * Hacker News: stories come from the official Firebase API. A user's
 * favorites are public, so we read their /favorites page with no login.
 * We never ask for HN credentials.
 */

const FIREBASE = "https://hacker-news.firebaseio.com/v0"
const SITE = "https://news.ycombinator.com"
const UA = "frontpage/0.1 (HN reader that ranks stories by interest; https://frontpage.fly.dev)"

export const LISTS = {
  top: "topstories",
  new: "newstories",
  best: "beststories",
  ask: "askstories",
  show: "showstories",
} as const
export type ListName = keyof typeof LISTS

export interface HNItem {
  id: number
  type: "story" | "job" | "comment" | "poll" | "pollopt"
  by?: string
  time: number
  title?: string
  url?: string
  text?: string
  score?: number
  descendants?: number
  dead?: boolean
  deleted?: boolean
}

export interface SavedStory {
  id: number
  title: string
  url?: string
  site?: string
}

const ITEM_TTL_MS = 5 * 60_000
const LIST_TTL_MS = 60_000
const listCache = new Map<ListName, { at: number; ids: number[] }>()

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "user-agent": UA } })
  if (!res.ok) throw new Error(`HN API ${res.status} for ${url}`)
  return (await res.json()) as T
}

export async function listIds(list: ListName): Promise<number[]> {
  const hit = listCache.get(list)
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.ids
  const ids = await getJson<number[]>(`${FIREBASE}/${LISTS[list]}.json`)
  listCache.set(list, { at: Date.now(), ids })
  return ids
}

/** HN items, cached in memory for a few minutes (scores and comment counts move fast; titles rarely change). */
const itemCache = new Map<number, { at: number; item: HNItem }>()

export async function item(id: number): Promise<HNItem | null> {
  const hit = itemCache.get(id)
  if (hit && Date.now() - hit.at < ITEM_TTL_MS) return hit.item
  const fresh = await getJson<HNItem | null>(`${FIREBASE}/item/${id}.json`).catch(() => null)
  if (fresh) {
    itemCache.set(id, { at: Date.now(), item: fresh })
    if (itemCache.size > 5_000) {
      for (const [k, v] of itemCache) if (Date.now() - v.at >= ITEM_TTL_MS) itemCache.delete(k)
    }
  }
  return fresh ?? hit?.item ?? null
}

export async function mapLimit<T, R>(xs: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let next = 0
  const workers = Array.from({ length: Math.min(limit, xs.length) }, async () => {
    while (next < xs.length) {
      const i = next++
      out[i] = await fn(xs[i]!, i)
    }
  })
  await Promise.all(workers)
  return out
}

export async function stories(list: ListName, limit: number): Promise<HNItem[]> {
  const ids = (await listIds(list)).slice(0, limit)
  const items = await mapLimit(ids, 24, item)
  return items.filter((x): x is HNItem => !!x && !x.dead && !x.deleted && !!x.title)
}

export function siteOf(url?: string): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return undefined
  }
}

export function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<p>/gi, "\n\n").replace(/<[^>]+>/g, "")).trim()
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
}

// ── upvotes and favorites (scraped) ───────────────────────────────────────

/** Parse a story listing page (front page, /favorites). */
export async function parseStoryList(html: string): Promise<{ stories: SavedStory[]; more?: string }> {
  const found: SavedStory[] = []
  let current: (SavedStory & { titleDone?: boolean }) | undefined
  let inTitle = false
  let more: string | undefined

  await new HTMLRewriter()
    .on("tr.athing", {
      element(el) {
        const id = Number(el.getAttribute("id"))
        current = Number.isFinite(id) && id > 0 ? { id, title: "" } : undefined
        if (current) found.push(current)
      },
    })
    .on("span.titleline > a", {
      element(el) {
        inTitle = !!current && !current.titleDone
        if (!inTitle || !current) return
        const href = decodeEntities(el.getAttribute("href") ?? "")
        current.url = href.startsWith("item?id=") ? `${SITE}/${href}` : href
        el.onEndTag(() => {
          inTitle = false
          if (current) current.titleDone = true
        })
      },
      text(t) {
        if (inTitle && current) current.title += t.text
      },
    })
    .on("a.morelink", {
      element(el) {
        more = decodeEntities(el.getAttribute("href") ?? "") || undefined
      },
    })
    .transform(new Response(html))
    .text()

  return {
    stories: found
      .filter((s) => s.title)
      .map(({ id, title, url }) => ({ id, title: decodeEntities(title).trim(), url, site: siteOf(url) })),
    more,
  }
}

/** A user's public favorites. No login: HN shows these to anyone. */
export async function fetchFavorites(user: string, maxPages = 5): Promise<SavedStory[]> {
  let path: string | undefined = `favorites?id=${encodeURIComponent(user)}`
  const all: SavedStory[] = []
  for (let page = 0; path && page < maxPages; page++) {
    if (page > 0) await Bun.sleep(800) // be polite to HN
    const res = await fetch(`${SITE}/${path}`, { headers: { "user-agent": UA } })
    if (!res.ok) throw new Error(`HN returned ${res.status} for favorites`)
    const html = await res.text()
    if (/No such user/i.test(html)) throw new Error(`HN has no user named "${user}"`)
    const parsed = await parseStoryList(html)
    all.push(...parsed.stories)
    path = parsed.more
  }
  return all
}

const ALGOLIA = "https://hn.algolia.com/api/v1"

interface AlgoliaHit {
  objectID: string
  title?: string | null
  url?: string | null
  created_at_i?: number
}

/** Stories a user submitted, newest first, from HN's public Algolia search API. No login. */
export async function fetchSubmissions(user: string, max = 100): Promise<SavedStory[]> {
  const url = `${ALGOLIA}/search_by_date?tags=story,author_${encodeURIComponent(user)}&hitsPerPage=${Math.min(1000, max)}`
  const res = await fetch(url, { headers: { "user-agent": UA } })
  if (!res.ok) throw new Error(`HN search returned ${res.status} for submissions`)
  const { hits } = (await res.json()) as { hits: AlgoliaHit[] }
  return hits.flatMap((h) => {
    const id = Number(h.objectID)
    const title = h.title?.trim()
    if (!id || !title) return []
    const storyUrl = h.url || undefined
    return [{ id, title, url: storyUrl, site: siteOf(storyUrl) }]
  })
}
