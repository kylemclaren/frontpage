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

  /**
   * Take up to `n` from the budget now and return how much was granted. Callers
   * reserve before starting work and `refund` what they did not use, so requests
   * that overlap cannot each be admitted against the same remaining budget.
   */
  reserve(key: string, n: number): Reservation {
    const w = this.window(key)
    const granted = Math.max(0, Math.min(Math.floor(n), this.limit - w.used))
    w.used += granted
    let held = granted
    return {
      granted,
      // Refunds go to the window the reservation came from; once that window has
      // rolled over they change nothing.
      refund: (unused) => {
        const back = Math.max(0, Math.min(Math.floor(unused), held))
        held -= back
        w.used -= back
      },
    }
  }

  private prune(now: number) {
    for (const [k, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(k)
  }
}

export interface Reservation {
  readonly granted: number
  /** Give back part of the reservation that was not used. Never returns more than was granted. */
  refund(unused: number): void
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

/**
 * Reserve up to `want` new scoring questions for one visitor, against both the
 * visitor's budget and the shared one, before any scoring starts. Call `settle`
 * exactly once with the number of questions actually sent; the rest is refunded.
 */
export function reserveScoring(visitor: string, want: number, perVisitor = perVisitorScoring, shared = globalScoring) {
  const mine = perVisitor.reserve(visitor, want)
  const all = shared.reserve("all", mine.granted)
  mine.refund(mine.granted - all.granted)
  const granted = all.granted
  let settled = false
  return {
    granted,
    settle(used: number) {
      if (settled) return
      settled = true
      const unused = granted - Math.max(0, Math.min(used, granted))
      mine.refund(unused)
      all.refund(unused)
    },
  }
}

export function clientKey(req: Request, fallback?: string) {
  return req.headers.get("fly-client-ip") ?? fallback ?? "local"
}
