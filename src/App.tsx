import { MoonIcon, RefreshCwIcon, SunIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { AskAiDialog } from "@/components/ask-ai-dialog"
import { AskAiButton, InterestsCard } from "@/components/interests-card"
import { Logo } from "@/components/logo"
import { Spinner } from "@/components/spinner"
import { StoryRow } from "@/components/story-row"
import { useTheme } from "@/components/theme-provider"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, prefs, streamFeed, type Feed, type Interest, type List, type Mode, type Story } from "@/lib/api"
import { LIKED_SENT, profileView, useLocalProfile, type HnImport } from "@/lib/profile"
import type { ParsedItem } from "@/lib/ask-ai"

const LISTS: { value: List; label: string }[] = [
  { value: "top", label: "Top" },
  { value: "new", label: "New" },
  { value: "best", label: "Best" },
  { value: "ask", label: "Ask" },
  { value: "show", label: "Show" },
]

const relevance = (s: Story) => s.judgment?.relevance ?? -1

function Brand() {
  return (
    <div className="flex items-center gap-2 font-mono text-[17px] font-bold tracking-tight">
      <Logo className="size-7" />
      Frontpage
    </div>
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const dark =
    theme === "dark" ||
    (theme === "system" && typeof window !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches)
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Toggle dark mode"
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </Button>
  )
}

function FeedSkeleton() {
  return (
    <ul>
      {Array.from({ length: 8 }, (_, i) => (
        <li key={i} className="grid grid-cols-[2.25rem_1fr] gap-3 border-b px-1 py-3.5">
          <Skeleton className="size-9 rounded-full" />
          <div className="grid gap-2">
            <Skeleton className="h-4" style={{ width: `${45 + ((i * 37) % 45)}%` }} />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function App() {
  const [list, setList] = useState<List>(() => prefs.get("list", "top"))
  const [mode, setMode] = useState<Mode>(() => prefs.get("mode", "bubble"))
  const [threshold, setThreshold] = useState(() => prefs.get("threshold", 50))
  // Bumping `version` refetches the feed. Progress is tagged with the request it belongs to,
  // so a request with no progress yet is simply "the latest progress is for an older request".
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState<{ key: string; phase: "scoring" | "done"; error?: string } | null>(null)
  const [feed, setFeed] = useState<Feed | null>(null)
  const [scoringConfigured, setScoringConfigured] = useState(true)
  const [askOpen, setAskOpen] = useState(false)
  const { profile: local, setInterests, setHn } = useLocalProfile()
  const profile = useMemo(() => profileView(local, scoringConfigured), [local, scoringConfigured])

  // What the server needs from this browser's profile. A change refetches the feed.
  const liked = useMemo(() => (local.hn?.liked ?? []).slice(0, LIKED_SENT), [local.hn])
  const profileKey = useMemo(() => JSON.stringify([local.interests, liked.map((l) => l.id)]), [local.interests, liked])
  const requestKey = `${list}:${version}:${profileKey}`

  useEffect(() => prefs.set("list", list), [list])
  useEffect(() => prefs.set("mode", mode), [mode])
  useEffect(() => prefs.set("threshold", threshold), [threshold])

  const loadFeed = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    void api<{ scoringConfigured: boolean }>("/api/status").then((s) => setScoringConfigured(s.scoringConfigured))
  }, [])
  useEffect(() => {
    const request = new AbortController()
    const live = () => !request.signal.aborted
    streamFeed(
      { list, limit: 60, interests: local.interests, liked },
      (event) => {
        if (!live()) return
        if (event.type === "feed") {
          // Stories and every cached score, straight away.
          setFeed({ list: event.list, profileEmpty: event.profileEmpty, stories: event.stories, errors: [] })
          setResult({ key: requestKey, phase: event.pending ? "scoring" : "done" })
        } else if (event.type === "score") {
          setFeed(
            (f) =>
              f && {
                ...f,
                stories: f.stories.map((s) => (s.id === event.id ? { ...s, judgment: event.judgment } : s)),
              },
          )
        } else if (event.type === "done") {
          setFeed((f) => f && { ...f, stats: event.stats, errors: event.errors })
          setResult({ key: requestKey, phase: "done" })
        } else {
          setResult({ key: requestKey, phase: "done", error: event.error })
        }
      },
      request.signal,
    ).catch((e: Error) => live() && setResult({ key: requestKey, phase: "done", error: e.message }))
    return () => request.abort()
    // requestKey already encodes list, version and the profile fields sent.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey])

  /** No reply yet for the current request. */
  const fetching = result?.key !== requestKey
  /** Stories are on screen and the remaining scores are arriving. */
  const scoring = !fetching && result?.phase === "scoring"
  const loading = fetching || scoring
  const feedError = !fetching ? (result?.error ?? "") : ""

  function saveInterests(next: Partial<Interest>[]) {
    setInterests(next)
  }

  async function addFromAi(items: ParsedItem[]) {
    setInterests([...local.interests, ...items])
  }

  async function importHn(user: string) {
    setHn(await api<HnImport>("/api/hn/import", { method: "POST", body: { user } }))
  }

  async function forgetHn() {
    setHn(null)
  }

  const likedIds = useMemo(() => new Set((local.hn?.liked ?? []).map((l) => l.id)), [local.hn])

  const interestMap = useMemo(() => new Map(profile.interests.map((i) => [i.id, i])), [profile])

  const shown = useMemo(() => {
    if (!feed) return []
    if (feed.profileEmpty || mode === "hn") return feed.stories
    if (mode === "filter")
      return feed.stories.filter((s) => relevance(s) * 100 >= threshold).toSorted((a, b) => relevance(b) - relevance(a))
    return feed.stories.toSorted((a, b) => relevance(b) - relevance(a) || a.rank - b.rank)
  }, [feed, mode, threshold])

  const showSkeleton = fetching && (!feed || feed.list !== list)
  const stillScoring = scoring ? (feed?.stories.filter((s) => !s.judgment).length ?? 0) : 0
  // The feed's empty-state prompt and the sidebar's Ask-your-AI button never show together.
  const feedPrompt = Boolean(feed?.profileEmpty) && !showSkeleton
  const stats = feed?.stats

  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 sm:px-6">
          <Brand />
          <Tabs value={list} onValueChange={(v) => setList(v as List)}>
            <TabsList>
              {LISTS.map((l) => (
                <TabsTrigger key={l.value} value={l.value}>
                  {l.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="ml-auto flex items-center gap-1.5">
            <ToggleGroup
              variant="outline"
              size="sm"
              spacing={0}
              value={[mode]}
              onValueChange={(v) => v[0] && setMode(v[0] as Mode)}
              aria-label="How to order stories"
            >
              <ToggleGroupItem value="bubble" title="Most relevant first">
                Bubble up
              </ToggleGroupItem>
              <ToggleGroupItem value="filter" title="Hide stories below the threshold">
                Filter
              </ToggleGroupItem>
              <ToggleGroupItem value="hn" title="HN's own order, relevance shown">
                HN order
              </ToggleGroupItem>
            </ToggleGroup>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-7 px-4 pt-5 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0">
          <div className="mb-2 flex min-h-8 flex-wrap items-center gap-4">
            {mode === "filter" && (
              <div className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
                <span>Threshold</span>
                {/* Fixed-size box: the slider alone reports too small a width to flex layout and overlaps its neighbours. */}
                <div className="w-32 shrink-0">
                  <Slider
                    min={0}
                    max={100}
                    step={5}
                    value={[threshold]}
                    onValueChange={(v) => setThreshold(Array.isArray(v) ? (v[0] ?? 0) : v)}
                  />
                </div>
                <span className="w-9 shrink-0 font-mono text-foreground tabular-nums">{threshold}%</span>
              </div>
            )}
            <span className="flex-1 font-mono text-xs text-muted-foreground">
              {showSkeleton
                ? "Fetching stories…"
                : fetching
                  ? "Refreshing…"
                  : scoring
                    ? `Scoring ${stillScoring} ${stillScoring === 1 ? "story" : "stories"}…`
                    : stats
                      ? `${stats.stories} stories${stats.judgedNow ? ` · ${stats.judgedNow} scored just now` : ""}`
                      : ""}
            </span>
            <Button variant="outline" size="sm" onClick={() => void loadFeed()} disabled={loading}>
              {loading ? <Spinner /> : <RefreshCwIcon data-icon="inline-start" />}
              Refresh
            </Button>
          </div>

          {(feedError !== "" || (feed?.errors.length ?? 0) > 0) && (
            <Alert variant="destructive" className="mb-3">
              <AlertDescription>{feedError || `Scoring failed: ${feed!.errors.join(" · ")}`}</AlertDescription>
            </Alert>
          )}
          {(feed?.stats?.unscored ?? 0) > 0 && !loading && (
            <Alert className="mb-3">
              <AlertDescription>
                Scoring is paused for a few minutes, so {feed!.stats!.unscored} stories aren't scored yet. Refresh in a
                bit.
              </AlertDescription>
            </Alert>
          )}
          {!profile.scoringConfigured && (
            <Alert variant="destructive" className="mb-3">
              <AlertDescription>Set TYPESAFE_API_KEY in .env.local and restart to score stories.</AlertDescription>
            </Alert>
          )}
          {feedPrompt && (
            <Empty className="mb-4 border">
              <EmptyHeader>
                <EmptyTitle>Tell Frontpage what you're into</EmptyTitle>
                <EmptyDescription>Every story gets scored for you. The fastest way to start:</EmptyDescription>
              </EmptyHeader>
              <AskAiButton className="max-w-sm" onClick={() => setAskOpen(true)} />
            </Empty>
          )}

          {showSkeleton ? (
            <FeedSkeleton />
          ) : shown.length ? (
            <ul>
              {shown.map((s) => (
                <StoryRow
                  key={s.id}
                  story={likedIds.has(s.id) ? { ...s, upvoted: true } : s}
                  interests={interestMap}
                  dim={mode !== "filter" && s.judgment != null && s.judgment.relevance * 100 < threshold}
                  pending={scoring && !s.judgment}
                />
              ))}
            </ul>
          ) : scoring ? (
            // Filter view with nothing over the threshold yet: scores are still coming in.
            <FeedSkeleton />
          ) : (
            feed && (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>Nothing at or above {threshold}%</EmptyTitle>
                  <EmptyDescription>Lower the threshold, or switch to Bubble up.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )
          )}
        </section>

        <aside className="order-first grid content-start lg:order-none">
          <InterestsCard
            profile={profile}
            onChange={saveInterests}
            onAskAi={() => setAskOpen(true)}
            onImportHn={importHn}
            onForgetHn={forgetHn}
            hideAskAi={feedPrompt}
          />
        </aside>
      </main>

      <AskAiDialog open={askOpen} onOpenChange={setAskOpen} existing={profile.interests} onAdd={addFromAi} />
    </div>
  )
}
