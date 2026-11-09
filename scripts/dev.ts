/** Runs the Bun API (with hot reload) and the Vite dev server together. Open http://localhost:4791. */
const API_PORT = process.env.API_PORT || "4792"
const env = { ...process.env, API_PORT }

const procs = [
  Bun.spawn(["bun", "--hot", "server/server.ts"], {
    env: { ...env, PORT: API_PORT },
    stdout: "inherit",
    stderr: "inherit",
  }),
  Bun.spawn(["bunx", "--bun", "vite"], { env, stdout: "inherit", stderr: "inherit", stdin: "inherit" }),
]

function stop(code = 0) {
  for (const p of procs) p.kill()
  process.exit(code)
}
process.on("SIGINT", () => stop())
process.on("SIGTERM", () => stop())

// If either one dies, take the other down too.
const code = await Promise.race(procs.map((p) => p.exited))
stop(code)
