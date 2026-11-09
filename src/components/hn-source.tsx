import { PlusIcon, RefreshCwIcon, XIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Spinner } from "@/components/spinner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { plural, type Profile } from "@/lib/api"

/** One-line HN import for the Interests card footer. Reads a user's public favorites and submissions. */
export function HnSource({
  profile,
  onImport,
  onForget,
}: {
  profile: Profile
  onImport: (user: string) => Promise<void>
  onForget: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const focusRef = useRef<HTMLInputElement>(null)
  // Move focus into the form when it is opened by a click.
  useEffect(() => {
    if (open) focusRef.current?.focus()
  }, [open])
  const [user, setUser] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError("")
    try {
      await fn()
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const errorLine = error && <p className="text-xs text-destructive">{error}</p>

  if (profile.hnUser) {
    const fav = profile.liked.bySource.favorites ?? 0
    const sub = profile.liked.bySource.submitted ?? 0
    return (
      <div className="flex w-full min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2 text-xs">
          <span
            className="min-w-0 flex-1 truncate text-muted-foreground"
            title="Your HN favorites and submissions, used as a light hint. Your interests count far more."
          >
            <span className="font-medium text-foreground">HN</span> · {profile.hnUser} · {plural(fav, "favorite")} ·{" "}
            {plural(sub, "submission")}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Re-import from Hacker News"
            title="Re-import"
            disabled={busy}
            onClick={() => void run(() => onImport(profile.hnUser!))}
          >
            {busy ? <Spinner size={12} /> : <RefreshCwIcon />}
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Forget this HN account"
            title="Forget"
            className="hover:text-destructive"
            onClick={() => void run(onForget)}
          >
            <XIcon />
          </Button>
        </div>
        {errorLine}
      </div>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <PlusIcon className="size-3.5" />
        Import from Hacker News
      </button>
    )
  }

  return (
    <form
      className="grid w-full gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        void run(() => onImport(user.trim()))
      }}
    >
      <div className="flex items-center gap-1.5">
        <Input
          ref={focusRef}
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder="HN username"
          autoComplete="username"
          pattern="[A-Za-z0-9_\-]{2,15}"
          required
          className="h-7 text-xs"
        />
        <Button type="submit" size="sm" disabled={busy || !user.trim()}>
          {busy && <Spinner size={12} />}
          Import
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Cancel" onClick={() => setOpen(false)}>
          <XIcon />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Reads your public favorites and submissions as a light hint about your taste.
      </p>
      {errorLine}
    </form>
  )
}
