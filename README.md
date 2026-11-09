# Frontpage

**Hacker News, ranked for you.** Tell Frontpage what you're into, or let ChatGPT or Claude tell it for you, and every story on the front page gets a relevance score. Bubble the best ones up, filter out the rest, and skip topics you're tired of.

![Frontpage: Hacker News stories, each with a relevance score and the interest it matches](public/og.jpg)

Live at **[frontpage.fly.dev](https://frontpage.fly.dev)**.

## Features

- **Ask your AI.** Copy a prompt into ChatGPT, Claude or any assistant, paste its reply back, and keep the interests and skip topics you agree with. No login, no account.
- **Scores for every story.** Each story is checked against each of your interests; the best match drives most of the score.
- **Skip topics.** Mark things you'd rather not see ("crypto price talk", "AI launch hype") and matching stories sink.
- **Three views.** Bubble up (most relevant first), Filter (hide below a threshold), or HN order with relevance shown.
- **Optional HN import.** A username pulls in your public favorites and submissions as a light hint about your taste.
- **Private by default.** Your profile stays in your browser's local storage and is sent only with feed requests. The server keeps no accounts.

## How it works

```
browser (React + Vite + shadcn/ui)
  profile in localStorage ──► POST /api/feed { list, interests, liked }
                                   │
Bun server ────────────────────────┤
  HN Firebase API (stories, cached in memory for 5 min)
  TypeSafe API (one yes/no question per story × interest, batched)
  Postgres / SQLite (shared cache: one answer per story and question)
```

- **Scoring** asks the TypeSafe API typed yes/no questions: "Is this story mainly about _Postgres operations_?" for each interest, plus whether the story falls under a skip topic. The best interest match makes up 80% of the score.
- **Caching:** each answer is stored per story and question wording, never per reader. Readers who share an interest share its answers, removing an interest costs nothing, and adding one only asks the new questions. Answers expire after 14 days.
- **Streaming:** `/api/feed` replies with JSON lines. Stories and every cached score come first, then each remaining score as it is worked out, so the page never waits on the slowest batch. Identical questions already in flight are not asked twice.
- **Limits** protect the API key when the app is public: caps on profile size per request, a per-visitor budget of new scoring questions, and a global hourly budget. Past those, stories come back unscored with a note.

## Run it locally

Requires [Bun](https://bun.sh) 1.3 or later and a [TypeSafe](https://typesafe.ai) API key.

```sh
bun install
cp .env.example .env.local     # then set TYPESAFE_API_KEY
bun run dev                    # http://localhost:4791
```

`bun run dev` starts the API (port 4792, hot reload) and Vite (port 4791), with Vite forwarding `/api` to the API. Locally, the score cache is a SQLite file in `data/`.

| Script          | What it does                                              |
| --------------- | --------------------------------------------------------- |
| `bun run dev`   | API + Vite dev servers                                    |
| `bun run build` | Type-check and build the frontend into `dist/`            |
| `bun run start` | Production server: API and the built frontend on one port |
| `bun run check` | Format check (oxfmt), lint (oxlint), type check, tests    |

## Configuration

| Variable           | Required      | Purpose                                                                                                    |
| ------------------ | ------------- | ---------------------------------------------------------------------------------------------------------- |
| `TYPESAFE_API_KEY` | yes           | Scores stories. Without it the feed loads unscored.                                                        |
| `DATABASE_URL`     | production    | Postgres for the shared score cache. If unset, SQLite at `FRONTPAGE_DB` (default `data/frontpage.sqlite`). |
| `SITE_URL`         | at build time | Absolute origin for social preview tags, e.g. `https://frontpage.fly.dev`.                                 |
| `PORT`             | no            | Server port (default 4791).                                                                                |
| `JEV_MODEL`        | no            | Scoring model (default `jev-latest`).                                                                      |

## Deploy to Fly.io

The repo includes a `Dockerfile` (generated with [`@flydotio/dockerfile`](https://github.com/fly-apps/dockerfile-node)) and a `fly.toml`.

```sh
fly apps create <your-app>                       # and update app + SITE_URL to match
fly mpg create --name <your-db> --region iad     # Managed Postgres for the score cache
fly mpg attach <cluster-id> --app <your-app>     # sets DATABASE_URL
fly secrets set TYPESAFE_API_KEY=... --app <your-app>
fly deploy
```

The app is stateless apart from the Postgres cache, so it needs no volume.

## Stack

[Bun](https://bun.sh) · [React 19](https://react.dev) · [Vite](https://vite.dev) · [shadcn/ui](https://ui.shadcn.com) on [Base UI](https://base-ui.com) · [Tailwind CSS 4](https://tailwindcss.com) · [motion](https://motion.dev) · [Beam](https://libraries.dev/beam) · [loading.dev](https://loading.dev) · [oxlint](https://oxc.rs) and oxfmt

## License

[MIT](LICENSE)
