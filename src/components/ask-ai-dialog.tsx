import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react"
import { useMemo, useState } from "react"

import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { Interest } from "@/lib/api"
import { ASK_AI_PROMPT, chatgptUrl, claudeUrl, parseAiReply, type ParsedItem } from "@/lib/ask-ai"
import { cn } from "cn"

const keyOf = (x: ParsedItem) => `${x.avoid}:${x.label.toLowerCase()}`

function Step({ n, title, aside, children }: { n: number; title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      <div className="flex items-baseline gap-2.5 text-sm font-medium">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-foreground font-mono text-[11px] text-background">
          {n}
        </span>
        {title}
        {aside && <span className="font-mono text-xs font-normal text-muted-foreground">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

export function AskAiDialog({
  open,
  onOpenChange,
  existing,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  existing: Interest[]
  onAdd: (items: ParsedItem[]) => Promise<void>
}) {
  const [reply, setReply] = useState("")
  const [unticked, setUnticked] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)

  const have = useMemo(() => new Set(existing.map((i) => i.label.toLowerCase())), [existing])
  const items = useMemo(() => parseAiReply(reply), [reply])
  const isDupe = (x: ParsedItem) => have.has(x.label.toLowerCase())
  const kept = items.filter((x) => !isDupe(x) && !unticked.has(keyOf(x)))

  async function copy() {
    try {
      await navigator.clipboard.writeText(ASK_AI_PROMPT)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard blocked: the prompt is selectable in the box above.
    }
  }

  async function save() {
    setSaving(true)
    try {
      await onAdd(kept)
      setReply("")
      setUnticked(new Set())
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  const toggle = (x: ParsedItem, on: boolean) =>
    setUnticked((prev) => {
      const next = new Set(prev)
      if (on) next.delete(keyOf(x))
      else next.add(keyOf(x))
      return next
    })

  const group = (title: string, list: ParsedItem[]) =>
    list.length > 0 && (
      <div className="grid gap-1">
        <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h4>
        {list.map((x) => {
          const dupe = isDupe(x)
          return (
            <Label
              key={keyOf(x)}
              className={cn(
                "grid cursor-pointer grid-cols-[auto_1fr] items-start gap-3 rounded-lg px-2 py-1.5 font-normal hover:bg-muted",
                dupe && "cursor-default opacity-50",
              )}
            >
              <Checkbox
                className="mt-0.5"
                checked={!dupe && !unticked.has(keyOf(x))}
                disabled={dupe}
                onCheckedChange={(on) => toggle(x, on)}
              />
              <div>
                <div className={cn("text-sm font-medium", x.avoid && "line-through decoration-muted-foreground")}>
                  {x.label}
                </div>
                <div className="text-xs text-muted-foreground">
                  {dupe ? "Already in your interests" : x.description !== x.label ? x.description : ""}
                </div>
              </div>
            </Label>
          )
        })}
      </div>
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-3rem)] gap-5 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg">Ask your AI what you're into</DialogTitle>
          <DialogDescription>
            Your assistant already knows your work and projects. Ask it, read its answer, and paste back only what you
            want to keep. No login, no account.
          </DialogDescription>
        </DialogHeader>

        <Step n={1} title="Copy this prompt into ChatGPT, Claude, or any assistant">
          <pre className="max-h-36 overflow-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground select-all">
            {ASK_AI_PROMPT}
          </pre>
          {/* Phones: Copy prompt across the top, the two assistants side by side under it. */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Button size="sm" className="col-span-2 max-sm:h-9" onClick={copy}>
              {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
              {copied ? "Copied" : "Copy prompt"}
            </Button>
            <a
              href={chatgptUrl()}
              target="_blank"
              rel="noopener"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-sm:h-9")}
            >
              Open in ChatGPT
              <ExternalLinkIcon data-icon="inline-end" />
            </a>
            <a
              href={claudeUrl()}
              target="_blank"
              rel="noopener"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-sm:h-9")}
            >
              Open in Claude
              <ExternalLinkIcon data-icon="inline-end" />
            </a>
          </div>
        </Step>

        <Step n={2} title="Paste its reply">
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={6}
            className="font-mono text-xs"
            placeholder={
              "INTERESTS\n- Postgres internals :: query planning, MVCC, extensions\n\nSKIP\n- Crypto :: token launches and price talk"
            }
          />
        </Step>

        <Step
          n={3}
          title="Keep what's right"
          aside={items.length ? `${kept.length} of ${items.length} selected` : undefined}
        >
          {items.length ? (
            <div className="grid gap-3">
              {group(
                "Show me more",
                items.filter((x) => !x.avoid),
              )}
              {group(
                "Skip",
                items.filter((x) => x.avoid),
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {reply.trim()
                ? "No list found yet. If your AI asked questions, answer them, then paste its final list."
                : "Items from the reply appear here. Untick anything you don't want."}
            </p>
          )}
        </Step>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            Only the topics you keep are saved, and only on this machine.
          </span>
          <Button onClick={save} disabled={kept.length === 0 || saving} className="max-sm:h-10 max-sm:w-full">
            {kept.length ? `Add ${kept.length} to my feed` : "Add to my feed"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
