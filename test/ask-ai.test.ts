import { describe, expect, test } from "bun:test"
import { parseAiReply } from "../src/lib/ask-ai"

describe("parseAiReply", () => {
  test("reads the requested format inside a code fence", () => {
    const reply = [
      "Here's your profile:",
      "```",
      "INTERESTS",
      "- Postgres internals :: query planning, MVCC, extensions",
      "- Fly.io / edge compute :: running apps close to users",
      "",
      "SKIP",
      "- Crypto :: token launches and price talk",
      "```",
    ].join("\n")
    expect(parseAiReply(reply)).toEqual([
      { label: "Postgres internals", description: "query planning, MVCC, extensions", avoid: false },
      { label: "Fly.io / edge compute", description: "running apps close to users", avoid: false },
      { label: "Crypto", description: "token launches and price talk", avoid: true },
    ])
  })

  test("tolerates markdown headings, bold, numbering and other separators", () => {
    const reply = [
      "## Interests:",
      "1. **Rust** — async runtimes and embedded",
      "2. Local-first software: CRDTs and sync engines",
      "### Things to skip",
      "* AI hype - funding rounds and benchmark bragging",
    ].join("\n")
    const items = parseAiReply(reply)
    expect(items.map((i) => [i.label, i.avoid])).toEqual([
      ["Rust", false],
      ["Local-first software", false],
      ["AI hype", true],
    ])
    expect(items[1]!.description).toBe("CRDTs and sync engines")
  })

  test("uses the label as description when none is given, and drops duplicates", () => {
    expect(parseAiReply("- Homelab\n- homelab\n- Kubernetes")).toEqual([
      { label: "Homelab", description: "Homelab", avoid: false },
      { label: "Kubernetes", description: "Kubernetes", avoid: false },
    ])
  })

  test("ignores prose with no bullets", () => {
    expect(parseAiReply("I don't know much about you yet. What do you work on?")).toEqual([])
  })
})
