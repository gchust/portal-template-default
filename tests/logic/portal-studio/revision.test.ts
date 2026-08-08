import { describe, expect, it } from "vitest";

import {
  buildRevisionInfo,
  computeSourceRevision,
  evaluateRevisionMatch,
  performBoundedWait,
} from "@/studio/endpoint";

describe("computeSourceRevision", () => {
  it("is stable regardless of file order and changes with content", () => {
    const files = [
      { file: "/a.ts", content: "const a = 1;" },
      { file: "/b.ts", content: "const b = 2;" },
    ];
    const forward = computeSourceRevision(files);
    const reversed = computeSourceRevision([...files].reverse());
    expect(forward).toBe(reversed);
    expect(forward).toMatch(/^[0-9a-f]{64}$/);

    const changed = computeSourceRevision([
      { file: "/a.ts", content: "const a = 2;" },
      { file: "/b.ts", content: "const b = 2;" },
    ]);
    expect(changed).not.toBe(forward);
  });

  it("hashes missing files as a marker so deletion changes the revision", () => {
    const before = computeSourceRevision([
      { file: "/a.ts", content: "code" },
    ]);
    const deleted = computeSourceRevision([{ file: "/a.ts", content: "<missing>" }]);
    expect(deleted).not.toBe(before);
  });
});

describe("evaluateRevisionMatch (honest semantics, contract §10)", () => {
  it("treats the reload bump as the authoritative success signal", () => {
    expect(
      evaluateRevisionMatch({
        browserRevision: 3,
        baselineBrowserRevision: 2,
        hmrAck: false,
        heartbeatOnline: false,
      })
    ).toBe(true);
  });

  it("requires online + hmrAck together for the informational HMR path", () => {
    expect(
      evaluateRevisionMatch({
        browserRevision: 2,
        baselineBrowserRevision: 2,
        hmrAck: true,
        heartbeatOnline: true,
      })
    ).toBe(true);
    // HMR ack alone, browser not online: never trusted.
    expect(
      evaluateRevisionMatch({
        browserRevision: 2,
        baselineBrowserRevision: 2,
        hmrAck: true,
        heartbeatOnline: false,
      })
    ).toBe(false);
    // Online alone without any ack/bump: never trusted.
    expect(
      evaluateRevisionMatch({
        browserRevision: 2,
        baselineBrowserRevision: 2,
        hmrAck: false,
        heartbeatOnline: true,
      })
    ).toBe(false);
  });

  it("handles a missing baseline (first revision) conservatively", () => {
    expect(
      evaluateRevisionMatch({
        browserRevision: 1,
        baselineBrowserRevision: undefined,
        hmrAck: false,
        heartbeatOnline: false,
      })
    ).toBe(false);
  });
});

describe("performBoundedWait", () => {
  const sleep = async () => undefined;

  it("returns matched immediately when the state already matches", async () => {
    const now = 1_000;
    const result = await performBoundedWait({
      timeoutMs: 10_000,
      now: () => now,
      sleep,
      readState: () => ({
        browserRevision: 5,
        baselineBrowserRevision: 4,
        hmrAck: false,
        heartbeatOnline: false,
      }),
    });
    expect(result).toEqual({ matched: true, attempts: 1 });
  });

  it("times out to stale when the state never matches (deadline enforced)", async () => {
    let now = 1_000;
    const result = await performBoundedWait({
      timeoutMs: 5_000,
      now: () => {
        now += 1_000;
        return now;
      },
      sleep,
      readState: () => ({
        browserRevision: 1,
        baselineBrowserRevision: 1,
        hmrAck: false,
        heartbeatOnline: false,
      }),
    });
    expect(result.matched).toBe(false);
    expect(result.attempts).toBeGreaterThan(1);
  });

  it("matches mid-wait when the state flips (HMR ack arrives while online)", async () => {
    let now = 1_000;
    let flipped = false;
    const result = await performBoundedWait({
      timeoutMs: 10_000,
      now: () => {
        now += 500;
        return now;
      },
      sleep,
      readState: () => {
        if (now >= 2_500) flipped = true;
        return {
          browserRevision: 1,
          baselineBrowserRevision: 1,
          hmrAck: flipped,
          heartbeatOnline: true,
        };
      },
    });
    expect(result.matched).toBe(true);
  });

  it("never matches for an offline browser with an unacked edit", async () => {
    let now = 1_000;
    const result = await performBoundedWait({
      timeoutMs: 3_000,
      now: () => {
        now += 1_000;
        return now;
      },
      sleep,
      readState: () => ({
        browserRevision: 1,
        baselineBrowserRevision: 1,
        hmrAck: false,
        heartbeatOnline: false,
      }),
    });
    expect(result.matched).toBe(false);
  });
});

describe("buildRevisionInfo", () => {
  it("records source/browser revision, ack, state, and timestamps", () => {
    const info = buildRevisionInfo(
      "abc123def456",
      7,
      true,
      "matched",
      1_700_000_000_000,
      "2026-08-07T12:00:10.000Z"
    );
    expect(info).toEqual({
      sourceRevision: "abc123def456",
      browserRevision: 7,
      hmrAck: true,
      expectedAfter: "2026-08-07T12:00:10.000Z",
      state: "matched",
      checkedAt: new Date(1_700_000_000_000).toISOString(),
    });
    const pending = buildRevisionInfo("h", 1, false, "pending", 1_700_000_000_000);
    expect(pending.expectedAfter).toBeUndefined();
  });
});
