import { afterEach, expect, mock, test } from "bun:test"

process.env.FRONTPAGE_DB = ":memory:" // keep tests off the dev database
const { fetchSubmissions } = await import("../server/hn")

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

test("fetchSubmissions maps Algolia hits and drops ones without a title", async () => {
  const calls: string[] = []
  globalThis.fetch = mock(async (url: string | URL | Request) => {
    calls.push(String(url))
    return Response.json({
      hits: [
        {
          objectID: "17349377",
          title: "Primitive Tech – Build Swimming Pool",
          url: "https://www.youtube.com/watch?v=mn1DEeyqaT4",
        },
        { objectID: "7545446", title: "Ask HN: Text post with no URL", url: null },
        { objectID: "1", title: null, url: "https://example.com" },
      ],
    })
  }) as unknown as typeof fetch

  const out = await fetchSubmissions("pg", 50)
  expect(calls[0]).toBe("https://hn.algolia.com/api/v1/search_by_date?tags=story,author_pg&hitsPerPage=50")
  expect(out).toEqual([
    {
      id: 17349377,
      title: "Primitive Tech – Build Swimming Pool",
      url: "https://www.youtube.com/watch?v=mn1DEeyqaT4",
      site: "youtube.com",
    },
    { id: 7545446, title: "Ask HN: Text post with no URL", url: undefined, site: undefined },
  ])
})
