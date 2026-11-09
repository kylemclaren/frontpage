/**
 * The reader's profile lives in this browser (localStorage), not on the server.
 * It is sent with each feed request. Editing it in one tab updates the others.
 */
import { useCallback, useEffect, useState } from "react"

import type { Interest, Profile } from "@/lib/api"

export interface LikedStory {
  id: number
  title: string
  site?: string
}

export interface HnImport {
  user: string
  favorites: number
  submissions: number
  /** Favorites first, then newest submissions. Only the first few are sent as taste hints. */
  liked: LikedStory[]
}

export interface LocalProfile {
  interests: Interest[]
  hn: HnImport | null
}

const STORAGE_KEY = "frontpage:profile"
const EMPTY: LocalProfile = { interests: [], hn: null }
/** Matches the server's cap on taste hints per request. */
export const LIKED_SENT = 40

function read(): LocalProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<LocalProfile>
    return {
      interests: Array.isArray(parsed.interests) ? parsed.interests : [],
      hn: parsed.hn && typeof parsed.hn.user === "string" ? parsed.hn : null,
    }
  } catch {
    return EMPTY
  }
}

function write(p: LocalProfile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    // Private mode or storage blocked: the profile still works for this tab.
  }
}

function slug(label: string) {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "interest"
  )
}

/** Give every interest a stable, unique id and trim its fields (the server re-checks these). */
export function normalizeInterests(list: Partial<Interest>[]): Interest[] {
  const seen = new Set<string>()
  return list.flatMap((raw) => {
    const label = (raw.label ?? "").trim().slice(0, 80)
    if (!label) return []
    let id = raw.id?.trim() || slug(label)
    while (seen.has(id) || id === "none") id += "-2"
    seen.add(id)
    const description = (raw.description ?? "").trim().slice(0, 300) || label
    return [{ id, label, description, ...(raw.avoid ? { avoid: true } : {}) }]
  })
}

export function useLocalProfile() {
  const [profile, setProfile] = useState<LocalProfile>(read)

  const update = useCallback((next: (p: LocalProfile) => LocalProfile) => {
    setProfile((p) => {
      const value = next(p)
      write(value)
      return value
    })
  }, [])

  // Keep tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setProfile(read())
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const setInterests = useCallback(
    (list: Partial<Interest>[]) => update((p) => ({ ...p, interests: normalizeInterests(list) })),
    [update],
  )
  const setHn = useCallback((hn: HnImport | null) => update((p) => ({ ...p, hn })), [update])

  return { profile, setInterests, setHn }
}

/** The shape the sidebar components render from. */
export function profileView(p: LocalProfile, scoringConfigured: boolean): Profile {
  return {
    interests: p.interests,
    hnUser: p.hn?.user ?? null,
    liked: {
      count: p.hn?.liked.length ?? 0,
      bySource: { favorites: p.hn?.favorites ?? 0, submitted: p.hn?.submissions ?? 0 },
    },
    scoringConfigured,
  }
}
