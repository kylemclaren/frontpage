import { BanIcon, StarIcon } from "lucide-react"

import { ScoreRing } from "@/components/score-ring"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { timeAgo, type Interest, type Story } from "@/lib/api"
import { cn } from "cn"

const pct = (v: number) => `${Math.round(v * 100)}%`

export function StoryRow({ story, interests, dim }: { story: Story; interests: Map<string, Interest>; dim: boolean }) {
  const j = story.judgment
  const matches = j
    ? Object.entries(j.interests)
        .filter(([id, p]) => p >= 0.5 && interests.has(id) && !interests.get(id)!.avoid)
        .toSorted((a, b) => b[1] - a[1])
        .slice(0, 3)
    : []
  const skip = j?.skip && j.avoid >= 0.5 ? interests.get(j.skip) : undefined

  return (
    <li
      className={cn(
        "grid grid-cols-[2.25rem_minmax(0,1fr)] items-start gap-3 border-b px-1 py-3 transition-opacity",
        dim && "opacity-45 hover:opacity-100",
      )}
    >
      <Tooltip>
        <TooltipTrigger render={<div className="cursor-default" />}>
          <ScoreRing value={j ? j.relevance : null} />
        </TooltipTrigger>
        <TooltipContent side="right">
          {j ? (
            <div className="grid gap-0.5">
              <span>Relevance {pct(j.relevance)}</span>
              <span className="opacity-70">Best interest match {pct(j.match)}</span>
              <span className="opacity-70">Would open {pct(j.fit)}</span>
              {j.avoid > 0.05 && <span className="opacity-70">Skip topic {pct(j.avoid)}</span>}
            </div>
          ) : (
            "Not scored"
          )}
        </TooltipContent>
      </Tooltip>

      <div className="min-w-0">
        <a
          href={story.url}
          target="_blank"
          rel="noopener"
          className="font-medium leading-snug decoration-muted-foreground/50 underline-offset-4 visited:text-muted-foreground hover:underline"
        >
          {story.title}
        </a>
        {story.site && <span className="ml-1.5 text-xs text-muted-foreground">{story.site}</span>}

        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-xs text-muted-foreground">
          <span>#{story.rank}</span>
          <span>{story.score} pts</span>
          {story.by && <span>{story.by}</span>}
          <span>{timeAgo(story.time)}</span>
          <a
            href={`https://news.ycombinator.com/item?id=${story.id}`}
            target="_blank"
            rel="noopener"
            className="hover:text-foreground hover:underline"
          >
            {story.comments} comments
          </a>
          {matches.map(([id, p]) => (
            <Badge
              key={id}
              variant="secondary"
              title={`${pct(p)} this interest`}
              className={cn(id === j?.best && "bg-brand/15 text-brand")}
            >
              {interests.get(id)!.label}
            </Badge>
          ))}
          {skip && (
            <Badge
              variant="outline"
              className="border-dashed text-muted-foreground"
              title={`${pct(j!.avoid)} a topic you skip`}
            >
              <BanIcon data-icon="inline-start" />
              {skip.label}
            </Badge>
          )}
          {story.upvoted && (
            <Badge variant="outline" className="text-muted-foreground" title="In your HN favorites or submissions">
              <StarIcon data-icon="inline-start" />
              yours
            </Badge>
          )}
        </div>
      </div>
    </li>
  )
}
