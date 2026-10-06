import assert from "node:assert/strict";
import test from "node:test";
import { MicroManagerEmissionGuard, normalizeMicroManagerNote } from "../src/core/emission-guard.ts";

test("normalizes punctuation, case, and whitespace", () => {
  assert.equal(normalizeMicroManagerNote("  *STOP.*  "), "stop");
  assert.equal(normalizeMicroManagerNote("Missing await() — loses 2 writes"), "missing await loses 2 writes");
});

test("drops content-free phrases without consuming the update budget", () => {
  const guard = new MicroManagerEmissionGuard();
  guard.beginUpdate();
  assert.equal(guard.accept("No issue; continue."), false);
  assert.equal(guard.accept("The write is not awaited, so buffered output can be lost."), true);
});

test("dedupes normalized notes across updates", () => {
  const guard = new MicroManagerEmissionGuard();
  guard.beginUpdate();
  assert.equal(guard.accept("Missing await on close()."), true);
  guard.beginUpdate();
  assert.equal(guard.accept("missing await on close"), false);
});

test("allows at most one accepted note per update", () => {
  const guard = new MicroManagerEmissionGuard();
  guard.beginUpdate();
  assert.equal(guard.accept("First concrete issue"), true);
  assert.equal(guard.accept("Second concrete issue"), false);
  guard.beginUpdate();
  assert.equal(guard.accept("Second concrete issue"), true);
});

test("reset clears history and update state", () => {
  const guard = new MicroManagerEmissionGuard();
  guard.beginUpdate();
  assert.equal(guard.accept("A real concern"), true);
  guard.reset();
  assert.equal(guard.accept("A real concern"), true);
});

test("evicts oldest notes at capacity", () => {
  const guard = new MicroManagerEmissionGuard({ capacity: 2 });
  for (const note of ["one issue", "two issue", "three issue"]) {
    guard.beginUpdate();
    assert.equal(guard.accept(note), true);
  }
  guard.beginUpdate();
  assert.equal(guard.accept("one issue"), true);
});
