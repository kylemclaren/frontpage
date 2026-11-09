import { BorderBeam } from "border-beam"
import { ArrowRightIcon, PlusIcon, XIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { AnimatedItem } from "@/components/animated-item"
import { FadeScrollArea } from "@/components/fade-scroll-area"
import { HnSource } from "@/components/hn-source"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useResolvedTheme } from "@/hooks/use-resolved-theme"
import type { Interest, Profile } from "@/lib/api"
import { cn } from "cn"

function InterestItem({ interest, onRemove }: { interest: Interest; onRemove: () => void }) {
  return (
    <AnimatedItem className="group grid grid-cols-[1fr_auto] items-start gap-2">
      <div className="min-w-0">
        <div className={cn("text-sm font-medium", interest.avoid && "text-muted-foreground line-through")}>
          {interest.label}
        </div>
        {interest.description !== interest.label && (
          <div className="text-xs leading-relaxed text-muted-foreground">{interest.description}</div>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Remove ${interest.label}`}
        className="text-muted-foreground opacity-60 group-hover:opacity-100 hover:text-destructive"
        onClick={onRemove}
      >
        <XIcon />
      </Button>
    </AnimatedItem>
  )
}

export function AskAiButton({
  onClick,
  compact = false,
  className,
}: {
  onClick: () => void
  /** One line, for when the reader already has interests. */
  compact?: boolean
  className?: string
}) {
  const theme = useResolvedTheme()
  return (
    <BorderBeam size="md" colorVariant="sunset" theme={theme} strength={0.8} className={cn("w-full", className)}>
      <button
        type="button"
        onClick={onClick}
        title={compact ? "Bring your interests over from ChatGPT or Claude" : undefined}
        className={cn(
          "group flex w-full items-center gap-3 rounded-xl border bg-card px-3.5 text-left transition-colors hover:bg-muted/60",
          compact ? "py-2" : "py-2.5",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Ask your AI</span>
          {!compact && (
            <span className="block text-xs text-muted-foreground">
              Bring your interests over from ChatGPT or Claude
            </span>
          )}
        </span>
        <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
      </button>
    </BorderBeam>
  )
}

export function InterestsCard({
  profile,
  onChange,
  onAskAi,
  onImportHn,
  onForgetHn,
  hideAskAi = false,
  className,
}: {
  profile: Profile
  onChange: (next: Partial<Interest>[]) => void
  onAskAi: () => void
  onImportHn: (user: string) => Promise<void>
  onForgetHn: () => Promise<void>
  /** True while the feed shows its own "Ask your AI" prompt, so the two never appear together. */
  hideAskAi?: boolean
  className?: string
}) {
  const { interests } = profile
  const [adding, setAdding] = useState(false)
  const focusRef = useRef<HTMLInputElement>(null)
  // Move focus into the form when it is opened by a click.
  useEffect(() => {
    if (adding) focusRef.current?.focus()
  }, [adding])
  const [label, setLabel] = useState("")
  const [description, setDescription] = useState("")
  const [avoid, setAvoid] = useState(false)

  const wants = interests.filter((i) => !i.avoid)
  const skips = interests.filter((i) => i.avoid)
  const remove = (id: string) => onChange(interests.filter((x) => x.id !== id))

  function add(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim()) return
    onChange([...interests, { label: label.trim(), description: description.trim(), avoid }])
    setLabel("")
    setDescription("")
    setAvoid(false)
  }

  function closeAdd() {
    setAdding(false)
    setLabel("")
    setDescription("")
    setAvoid(false)
  }

  return (
    // On wide screens the card stays pinned under the header; the list takes whatever height is left.
    <Card className={cn("lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100svh-5.5rem)]", className)}>
      <CardHeader>
        <CardTitle className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Interests</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        {!hideAskAi && <AskAiButton onClick={onAskAi} compact={interests.length > 0} className="shrink-0" />}

        {interests.length ? (
          // The list scrolls inside the card; its top/bottom edges fade where there is more to see.
          <FadeScrollArea className="-mx-2 max-h-[22rem] lg:max-h-none lg:flex-1" viewportClassName="px-2 py-1">
            <ul className="grid gap-3">
              {wants.map((i) => (
                <InterestItem key={i.id} interest={i} onRemove={() => remove(i.id)} />
              ))}
            </ul>
            {skips.length > 0 && (
              <div className="mt-4 grid gap-2">
                <h3 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Skip</h3>
                <ul className="grid gap-3">
                  {skips.map((i) => (
                    <InterestItem key={i.id} interest={i} onRemove={() => remove(i.id)} />
                  ))}
                </ul>
              </div>
            )}
          </FadeScrollArea>
        ) : (
          <p className="text-sm text-muted-foreground">No interests yet.</p>
        )}

        <div className="shrink-0 border-t pt-3">
          {adding ? (
            <form onSubmit={add} className="grid gap-2">
              <Input
                ref={focusRef}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Topic, e.g. Rust"
                maxLength={80}
              />
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Narrow it down, e.g. async, compilers"
                maxLength={300}
              />
              <div className="flex items-center gap-2">
                <Label className="mr-auto font-normal text-muted-foreground">
                  <Checkbox checked={avoid} onCheckedChange={(on) => setAvoid(on)} />
                  Skip this topic instead
                </Label>
                <Button type="button" variant="ghost" size="sm" onClick={closeAdd}>
                  Done
                </Button>
                <Button type="submit" size="sm" disabled={!label.trim()}>
                  Add
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => setAdding(true)}>
              <PlusIcon data-icon="inline-start" />
              Add a topic
            </Button>
          )}
        </div>
      </CardContent>
      <CardFooter className="shrink-0 py-2.5">
        <HnSource profile={profile} onImport={onImportHn} onForget={onForgetHn} />
      </CardFooter>
    </Card>
  )
}
