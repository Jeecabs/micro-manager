import assert from "node:assert/strict";
import test from "node:test";
import { AdvisorEmissionGuard, normalizeAdvisorNote } from "../src/emission-guard.ts";

test("normalizes punctuation, case, and whitespace", () => {
  assert.equal(normalizeAdvisorNote("  *STOP.*  "), "stop");
  assert.equal(normalizeAdvisorNote("Missing await() — loses 2 writes"), "missing await loses 2 writes");
});

test("drops content-free phrases without consuming the update budget", () => {
  const guard = new AdvisorEmissionGuard();
  guard.beginUpdate();
  assert.equal(guard.accept("No issue; continue."), false);
  assert.equal(guard.accept("The write is not awaited, so buffered output can be lost."), true);
});

test("dedupes normalized notes across updates", () => {
  const guard = new AdvisorEmissionGuard();
  guard.beginUpdate();
  assert.equal(guard.accept("Missing await on close()."), true);
  guard.beginUpdate();
  assert.equal(guard.accept("missing await on close"), false);
});

test("allows at most one accepted note per update", () => {
  const guard = new AdvisorEmissionGuard();
  guard.beginUpdate();
  assert.equal(guard.accept("First concrete issue"), true);
  assert.equal(guard.accept("Second concrete issue"), false);
  guard.beginUpdate();
  assert.equal(guard.accept("Second concrete issue"), true);
});

test("reset clears history and update state", () => {
  const guard = new AdvisorEmissionGuard();
  guard.beginUpdate();
  assert.equal(guard.accept("A real concern"), true);
  guard.reset();
  assert.equal(guard.accept("A real concern"), true);
});

test("evicts oldest notes at capacity", () => {
  const guard = new AdvisorEmissionGuard({ capacity: 2 });
  for (const note of ["one issue", "two issue", "three issue"]) {
    guard.beginUpdate();
    assert.equal(guard.accept(note), true);
  }
  guard.beginUpdate();
  assert.equal(guard.accept("one issue"), true);
});
