/**
 * Frontpage API. The server keeps no reader profiles: each browser stores its
 * own interests and HN import and sends them with every feed request. What the
 * server does keep is shared and safe to share: cached HN items and cached
 * answers (one per story and question, never per reader), so readers who share
 * an interest share the work.
 */
import { join, normalize } from "node:path"
import { isEmpty, judge, profileQuestions, type Profile } from "./classify"
import { fetchFavorites, fetchSubmissions, LISTS, siteOf, stories, type ListName, type SavedStory } from "./hn"
import { hasApiKey, PRICE_PER_INPUT_TOKEN } from "./jev"
import { clientKey, perVisitorImports, reserveScoring } from "./limits"
import type { Interest } from "./topics"

/** Caps on what a browser may send, so one request can't ask for unbounded scoring. */
const MAX_INTERESTS = 30
const MAX_LIKED = 40
const MAX_STORIES = 60
/** How many imported HN stories we hand back for the browser to keep. */
const MAX_IMPORTED = 100

const json = (data: unknown, status = 200) => Response.json(data, { status })
const fail = (err: unknown, status = 500) => json({ error: err instanceof Error ? err.message : String(err) }, status)

function slug(label: string) {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "interest"
  )
}

function cleanInterests(input: unknown): Interest[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  return input.slice(0, MAX_INTERESTS).flatMap((raw) => {
    const label = String(raw?.label ?? "")
      .trim()
      .slice(0, 80)
    if (!label) return []
    let id =
      String(raw?.id ?? "")
        .trim()
        .slice(0, 60) || slug(label)
    while (seen.has(id) || id === "none") id += "-2"
    seen.add(id)
    const description =
      String(raw?.description ?? "")
        .trim()
        .slice(0, 300) || label
    return [{ id, label, description, ...(raw?.avoid ? { avoid: true } : {}) }]
  })
}

function cleanLiked(input: unknown): SavedStory[] {
  if (!Array.isArray(input)) return []
  return input.slice(0, MAX_LIKED).flatMap((raw) => {
    const id = Number(raw?.id)
    const title = String(raw?.title ?? "")
      .trim()
      .slice(0, 200)
    if (!Number.isInteger(id) || id <= 0 || !title) return []
    const site = raw?.site ? String(raw.site).slice(0, 100) : undefined
    return [{ id, title, ...(site ? { site } : {}) }]
  })
}

const port = Number(process.env.PORT || 4791)
const production = process.env.NODE_ENV === "production"
const DIST = join(import.meta.dir, "..", "dist")

/** In production, serve the Vite build; unknown paths fall back to index.html. In dev, Vite serves the UI. */
async function serveApp(req: Request): Promise<Response> {
  if (!production) return new Response("API only. In development, open the Vite server (bun run dev).", { status: 404 })
  const path = normalize(new URL(req.url).pathname).replace(/^(\.\.[/\\])+/, "")
  const file = Bun.file(join(DIST, path))
  if (path !== "/" && (await file.exists())) return new Response(file)
  return new Response(Bun.file(join(DIST, "index.html")))
}

const server = Bun.serve({
  port,
  development: !production,
  routes: {
    "/api/status": { GET: () => json({ scoringConfigured: hasApiKey() }) },

    /** Public HN favorites (scraped) and submissions (Algolia). Returns them for the browser to keep. */
    "/api/hn/import": {
      POST: async (req) => {
        try {
          const visitor = clientKey(req, server.requestIP(req)?.address)
          if (perVisitorImports.remaining(visitor) < 1) {
            return json({ error: "Too many imports. Try again in a few minutes." }, 429)
          }
          const body = (await req.json().catch(() => ({}))) as { user?: string }
          const user = body.user?.trim()
          if (!user || !/^[\w-]{2,15}$/.test(user)) return json({ error: "Enter a valid HN username" }, 400)
          perVisitorImports.spend(visitor, 1)
          // Favorites go first: they're the stronger signal, and only the first few are used as taste hints.
          const [favorites, submissions] = await Promise.all([fetchFavorites(user, 5), fetchSubmissions(user)])
          const seen = new Set<number>()
          const liked = [...favorites, ...submissions]
            .filter((s) => !seen.has(s.id) && seen.add(s.id))
            .slice(0, MAX_IMPORTED)
            .map((s): SavedStory => {
              const site = s.site ?? siteOf(s.url)
              return site ? { id: s.id, title: s.title, site } : { id: s.id, title: s.title }
            })
          return json({ user, favorites: favorites.length, submissions: submissions.length, liked })
        } catch (err) {
          return fail(err)
        }
      },
    },

    "/api/feed": {
      POST: async (req) => {
        try {
          const body = (await req.json().catch(() => ({}))) as {
            list?: string
            limit?: number
            interests?: unknown
            liked?: unknown
          }
          const list = (body.list ?? "top") as ListName
          if (!(list in LISTS)) return json({ error: `Unknown list ${list}` }, 400)
          const limit = Math.min(MAX_STORIES, Math.max(10, Number(body.limit) || MAX_STORIES))
          const profile: Profile = { interests: cleanInterests(body.interests), liked: cleanLiked(body.liked) }

          const items = await stories(list, limit)
          const visitor = clientKey(req, server.requestIP(req)?.address)
          // Reserve the most this request could ask before scoring starts, so overlapping
          // requests can't all be admitted against the same budget. Unused questions
          // (cached answers, mostly) are refunded when scoring finishes.
          const questionsPerStory = new Set(profileQuestions(profile).map((q) => q.key)).size
          const reservation = reserveScoring(visitor, questionsPerStory * items.length)
          const maxQuestions = reservation.granted
          const started = performance.now()

          // The reply is a stream of JSON lines: the stories with every score already
          // cached, then one line per story as its score arrives, then the totals.
          const encoder = new TextEncoder()
          const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
              let open = true
              const send = (event: unknown) => {
                if (!open) return
                try {
                  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
                } catch {
                  open = false // the reader went away; scoring still finishes and is cached
                }
              }
              let asked = 0
              try {
                const result = await judge(items, profile, {
                  maxQuestions,
                  onCached: (judgments, pending) =>
                    send({
                      type: "feed",
                      list,
                      profileEmpty: isEmpty(profile),
                      pending,
                      stories: items.map((s, rank) => ({
                        id: s.id,
                        rank: rank + 1,
                        title: s.title,
                        url: s.url ?? `https://news.ycombinator.com/item?id=${s.id}`,
                        site: siteOf(s.url),
                        by: s.by,
                        time: s.time,
                        score: s.score ?? 0,
                        comments: s.descendants ?? 0,
                        judgment: judgments.get(s.id) ?? null,
                      })),
                    }),
                  onScored: (id, judgment) => send({ type: "score", id, judgment }),
                })
                asked = result.asked
                send({
                  type: "done",
                  stats: {
                    stories: items.length,
                    judgedNow: result.fresh,
                    unscored: result.skipped,
                    questions: result.asked,
                    inputTokens: result.inputTokens,
                    costUsd: result.inputTokens * PRICE_PER_INPUT_TOKEN,
                    ms: Math.round(performance.now() - started),
                  },
                  errors: [...new Set(result.errors)],
                })
              } catch (err) {
                send({ type: "error", error: err instanceof Error ? err.message : String(err) })
              } finally {
                reservation.settle(asked)
              }
              if (open) controller.close()
            },
          })
          return new Response(stream, {
            headers: {
              "content-type": "application/x-ndjson; charset=utf-8",
              "cache-control": "no-store",
              "x-accel-buffering": "no",
            },
          })
        } catch (err) {
          return fail(err)
        }
      },
    },
  },
  fetch: (req) =>
    new URL(req.url).pathname.startsWith("/api/") ? new Response("Not found", { status: 404 }) : serveApp(req),
})

console.log(`Frontpage on ${server.url}${hasApiKey() ? "" : "  (no TYPESAFE_API_KEY: stories will not be scored)"}`)
