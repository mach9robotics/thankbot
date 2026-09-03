/**
 * Assertions for the board's month/week picker: which period a URL means, and
 * which periods are offered between the first card and today.
 *
 * Run: pnpm tsx scripts/test-time-range.ts
 */
import assert from "assert";
import {
  currentRange,
  listPeriodOptions,
  parseTimeRangeParams,
} from "../src/lib/time-range";

const NOW = new Date("2026-08-13T16:56:00Z");

// Months and ISO weeks are half-open [start, end), so a card written at the
// last instant of a period is never counted twice.
const august = currentRange("month", NOW);
assert.strictEqual(august.key, "2026-08");
assert.strictEqual(august.label, "August 2026");
assert.strictEqual(august.start.toISOString(), "2026-08-01T00:00:00.000Z");
assert.strictEqual(august.end.toISOString(), "2026-09-01T00:00:00.000Z");

const week = currentRange("week", NOW);
assert.strictEqual(week.key, "2026-W33");
assert.strictEqual(week.label, "Aug 10–16, 2026");
assert.strictEqual(week.start.toISOString(), "2026-08-10T00:00:00.000Z");
assert.strictEqual(week.end.toISOString(), "2026-08-17T00:00:00.000Z");
// ISO weeks start on Monday.
assert.strictEqual(week.start.getUTCDay(), 1);

// A week spanning two months names both.
assert.strictEqual(
  parseTimeRangeParams({ period: "week", range: "2026-W31" }).label,
  "Jul 27 – Aug 2, 2026"
);

// No params, or params nobody would type, fall back to the current period
// rather than showing an empty board.
assert.strictEqual(parseTimeRangeParams({}).key, currentRange("month").key);
for (const range of ["", "2026-13", "not-a-month", "2026-8", "20268"]) {
  assert.strictEqual(parseTimeRangeParams({ range }).kind, "month", range);
  assert.strictEqual(
    parseTimeRangeParams({ range }).key,
    currentRange("month").key,
    range
  );
}
for (const range of ["2026-W00", "2026-W54", "2026-W7", "August"]) {
  assert.strictEqual(
    parseTimeRangeParams({ period: "week", range }).key,
    currentRange("week").key,
    range
  );
}

// Anything other than "week" is a month, so a hand-edited URL cannot land the
// page on a period the picker can't show.
assert.strictEqual(parseTimeRangeParams({ period: "decade" }).kind, "month");
assert.strictEqual(parseTimeRangeParams({ period: "week" }).kind, "week");

// The picker offers every period from the first card to today, newest first.
assert.deepStrictEqual(
  listPeriodOptions("month", "2026-03-02T00:00:00Z", undefined, NOW).map(
    (option) => option.key
  ),
  ["2026-08", "2026-07", "2026-06", "2026-05", "2026-04", "2026-03"]
);
assert.deepStrictEqual(
  listPeriodOptions("week", "2026-07-28T00:00:00Z", undefined, NOW).map(
    (option) => option.key
  ),
  ["2026-W33", "2026-W32", "2026-W31"]
);

// Week options cross a year boundary by week number, not by January 1.
assert.deepStrictEqual(
  listPeriodOptions(
    "week",
    "2025-12-22T00:00:00Z",
    undefined,
    new Date("2026-01-08T00:00:00Z")
  ).map((option) => option.key),
  ["2026-W02", "2026-W01", "2025-W52"]
);

// An empty board still offers the current period.
for (const kind of ["month", "week"] as const) {
  const options = listPeriodOptions(kind, null, undefined, NOW);
  assert.deepStrictEqual(options.map((option) => option.key), [
    currentRange(kind, NOW).key,
  ]);
}

// A period picked from a URL stays selectable even when it holds no cards, so
// the dropdown always shows what the page is actually filtered to.
const older = parseTimeRangeParams({ range: "2025-11" });
assert.ok(
  listPeriodOptions("month", "2026-08-02T00:00:00Z", older, NOW).some(
    (option) => option.key === "2025-11"
  )
);

// A future period from a hand-edited URL is offered rather than dropped.
const future = parseTimeRangeParams({ range: "2027-01" });
const withFuture = listPeriodOptions(
  "month",
  "2026-08-02T00:00:00Z",
  future,
  NOW
);
assert.strictEqual(withFuture[0].key, "2027-01");

// Options are unique and strictly newest-first.
const many = listPeriodOptions("month", "2024-01-15T00:00:00Z", undefined, NOW);
assert.strictEqual(new Set(many.map((option) => option.key)).size, many.length);
for (let i = 1; i < many.length; i += 1) {
  assert.ok(many[i - 1].start.getTime() > many[i].start.getTime());
}

console.log("time range tests passed");
