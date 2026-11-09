/**
 * Simple in-memory fixed-window budgets. They protect the TypeSafe key and HN
 * from runaway clients now that anyone can send a profile. Fine for one
 * machine; they reset on restart, which is acceptable for a soft limit.
 */
export class Budget {
  private windows = new Map<string, { start: number; used: number }>()

  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}

  private window(key: string) {
    const now = Date.now()
    let w = this.windows.get(key)
    if (!w || now - w.start >= this.windowMs) {
      w = { start: now, used: 0 }
      this.windows.set(key, w)
      if (this.windows.size > 10_000) this.prune(now)
    }
    return w
  }

  remaining(key: string) {
    return Math.max(0, this.limit - this.window(key).used)
  }

  spend(key: string, n: number) {
    this.window(key).used += n
  }

  private prune(now: number) {
    for (const [k, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(k)
  }
}

/**
 * New scoring questions one visitor may trigger. A full 60-story feed costs one
 * question per story and interest, so this is about 6 uncached feeds of a
 * 15-interest profile every 10 minutes. Cached answers are free.
 */
export const perVisitorScoring = new Budget(6_000, 10 * 60_000)
/** New scoring questions across everyone, per hour (roughly $0.50 at today's prices). */
export const globalScoring = new Budget(100_000, 60 * 60_000)
/** HN imports one visitor may run (each fetches several HN pages). */
export const perVisitorImports = new Budget(10, 10 * 60_000)

export function clientKey(req: Request, fallback?: string) {
  return req.headers.get("fly-client-ip") ?? fallback ?? "local"
}
