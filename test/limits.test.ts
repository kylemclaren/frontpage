import { expect, setSystemTime, test } from "bun:test"
import { Budget, reserveScoring } from "../server/limits"

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

test("reserve takes the budget up front, so overlapping requests cannot share it", () => {
  const b = new Budget(100, 60_000)
  const first = b.reserve("a", 80)
  const second = b.reserve("a", 80)
  expect(first.granted).toBe(80)
  expect(second.granted).toBe(20)
  expect(b.reserve("a", 80).granted).toBe(0)

  first.refund(50)
  expect(b.remaining("a")).toBe(50)
  first.refund(500) // never returns more than it was granted
  expect(b.remaining("a")).toBe(80)
})

test("a refund after the window has rolled over leaves the new window alone", () => {
  setSystemTime(new Date("2026-11-09T12:00:00Z"))
  const b = new Budget(10, 60_000)
  const r = b.reserve("a", 10)
  setSystemTime(new Date("2026-11-09T12:01:00Z"))
  b.spend("a", 4)
  r.refund(10)
  expect(b.remaining("a")).toBe(6)
  setSystemTime()
})

test("reserveScoring holds both budgets and refunds what was not asked", () => {
  const perVisitor = new Budget(100, 60_000)
  const shared = new Budget(150, 60_000)
  const a = reserveScoring("a", 100, perVisitor, shared)
  const b = reserveScoring("b", 100, perVisitor, shared)
  expect(a.granted).toBe(100)
  expect(b.granted).toBe(50) // the shared budget ran out
  expect(perVisitor.remaining("b")).toBe(50)
  expect(reserveScoring("c", 100, perVisitor, shared).granted).toBe(0)

  a.settle(30)
  a.settle(0) // settling twice refunds once
  expect(perVisitor.remaining("a")).toBe(70)
  expect(shared.remaining("all")).toBe(70)
})
