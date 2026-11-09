/**
 * "Ask your AI": the reader copies a prompt into ChatGPT, Claude or any
 * assistant that already knows them, then pastes the reply back. No login,
 * and they read every word before it reaches us.
 */

export const ASK_AI_PROMPT = `I'm setting up a filter for Hacker News. Based on everything you know about me (my work, projects, tools, and what we've talked about), list what I'd want to read and what I'd rather skip.

Reply with only a code block in exactly this format:

INTERESTS
- <short topic> :: <one sentence on what specifically I care about>

SKIP
- <short topic> :: <what to filter out>

Give 5 to 12 interests and 0 to 6 skips. Be specific: "Postgres internals" beats "databases". Only include things you have real evidence for. If you don't know enough about me, say so, and ask me three questions instead.`

export const chatgptUrl = (prompt = ASK_AI_PROMPT) => `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`
export const claudeUrl = (prompt = ASK_AI_PROMPT) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`

export interface ParsedItem {
  label: string
  description: string
  avoid: boolean
}

// Checked in this order, so "not interested in" counts as a skip heading.
const SKIP_HEADING = /\b(skip|avoid|not interested|exclude|less of|filter out|don'?t show|dislikes?)\b/i
const WANT_HEADING = /\b(interests?|topics?|more of|likes?)\b/i
/** Strip markdown emphasis, inline code and heading/quote markers. */
const clean = (s: string) =>
  s
    .replace(/\*\*|__|`/g, "")
    .replace(/^[#>\s]+/, "")
    .trim()

/**
 * Parse an assistant's reply. Tolerates markdown bold, numbered lists,
 * code fences, and ":", " - " or "—" in place of "::".
 */
export function parseAiReply(text: string): ParsedItem[] {
  const items: ParsedItem[] = []
  const seen = new Set<string>()
  let avoid = false

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("```")) continue

    const bullet = /^(?:[-*•–]|\d+[.)])\s+(.*)$/.exec(line)
    if (!bullet) {
      const heading = clean(line).replace(/:$/, "")
      if (heading.length < 40 && SKIP_HEADING.test(heading)) avoid = true
      else if (heading.length < 40 && WANT_HEADING.test(heading)) avoid = false
      continue
    }
    // Bullets before any heading are treated as interests.
    const body = clean(bullet[1]!)
    const split = /\s*(?:::|\s[—–-]\s|:\s)\s*/.exec(body)
    const label = (split ? body.slice(0, split.index) : body).trim().replace(/[.:;]+$/, "")
    const description = (split ? body.slice(split.index + split[0].length) : "").trim()
    if (!label || label.length > 80) continue
    const key = `${avoid}:${label.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push({ label, description: description.slice(0, 300) || label, avoid })
  }
  return items
}
