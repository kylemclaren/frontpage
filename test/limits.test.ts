import { expect, setSystemTime, test } from "bun:test"
import { Budget } from "../server/limits"

test("Budget tracks spend per key and resets after its window", () => {
  setSystemTime(new Date("2026-11-09T12:00:00Z"))
  const b = new Budget(10, 60_000)
  b.spend("a", 7)
  expect(b.remaining("a")).toBe(3)
  expect(b.remaining("b")).toBe(10)
  b.spend("a", 5)
  expect(b.remaining("a")).toBe(0)

  setSystemTime(new Date("2026-11-09T12:01:00Z"))
  expect(b.remaining("a")).toBe(10)
  setSystemTime()
})
