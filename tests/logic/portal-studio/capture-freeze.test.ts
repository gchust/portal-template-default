import { afterEach, describe, expect, it } from "vitest";

import {
  createCaptureFreezeController,
  FREEZE_SAFE_STYLE_ID,
} from "@/studio/capture-freeze";

afterEach(() => {
  document.getElementById(FREEZE_SAFE_STYLE_ID)?.remove();
});

type FakeEngine = {
  freezeCalls: number;
  unfreezeCalls: number;
  frozen: boolean;
  failFreeze: boolean;
  failUnfreeze: boolean;
  freeze: () => void;
  unfreeze: () => void;
  isFrozen: () => boolean;
};

const makeEngine = (): FakeEngine => {
  const engine: FakeEngine = {
    freezeCalls: 0,
    unfreezeCalls: 0,
    frozen: false,
    failFreeze: false,
    failUnfreeze: false,
    freeze: () => {
      engine.freezeCalls += 1;
      if (engine.failFreeze) throw new Error("freeze boom");
      engine.frozen = true;
    },
    unfreeze: () => {
      engine.unfreezeCalls += 1;
      if (engine.failUnfreeze) throw new Error("unfreeze boom");
      engine.frozen = false;
    },
    isFrozen: () => engine.frozen,
  };
  return engine;
};

describe("capture freeze controller", () => {
  it("freezes exactly once per activation and unfreezes exactly once per exit", () => {
    const engine = makeEngine();
    const controller = createCaptureFreezeController({ engine });
    controller.setCaptureActive(true);
    controller.setCaptureActive(true); // idempotent
    expect(engine.freezeCalls).toBe(1);
    expect(controller.isFrozen()).toBe(true);
    expect(controller.getStatus()).toBe("frozen");

    controller.setCaptureActive(false);
    controller.setCaptureActive(false); // idempotent
    expect(engine.unfreezeCalls).toBe(1);
    expect(controller.isFrozen()).toBe(false);
    expect(controller.getStatus()).toBe("unfrozen");

    // Re-entering after an exit works.
    controller.setCaptureActive(true);
    expect(engine.freezeCalls).toBe(2);
    expect(controller.isFrozen()).toBe(true);
  });

  it("injects and removes the Studio-safe styles with the freeze", () => {
    const engine = makeEngine();
    const controller = createCaptureFreezeController({ engine });
    expect(document.getElementById(FREEZE_SAFE_STYLE_ID)).toBeNull();
    controller.setCaptureActive(true);
    const style = document.getElementById(FREEZE_SAFE_STYLE_ID);
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain("#portal-studio-root");
    expect(style?.textContent).toContain("animation-play-state: paused");
    controller.setCaptureActive(false);
    expect(document.getElementById(FREEZE_SAFE_STYLE_ID)).toBeNull();
  });

  it("surfaces a bounded error on freeze failure and retries on re-entry", () => {
    const engine = makeEngine();
    engine.failFreeze = true;
    const errors: string[] = [];
    const controller = createCaptureFreezeController({
      engine,
      onError: (message) => errors.push(message),
    });
    controller.setCaptureActive(true);
    expect(engine.freezeCalls).toBe(1);
    expect(controller.isFrozen()).toBe(false);
    expect(controller.getStatus()).toBe("error");
    expect(errors).toEqual([
      "Could not freeze the page for capture; the target may move while you annotate. You can still capture.",
    ]);
    // No frozen-style residue after a failed freeze.
    expect(document.getElementById(FREEZE_SAFE_STYLE_ID)).toBeNull();
    // Retry after the failure works.
    engine.failFreeze = false;
    controller.setCaptureActive(true);
    expect(engine.freezeCalls).toBe(2);
    expect(controller.isFrozen()).toBe(true);
    expect(controller.getStatus()).toBe("frozen");
  });

  it("removes the injected styles even when the upstream unfreeze throws", () => {
    const engine = makeEngine();
    const controller = createCaptureFreezeController({ engine });
    controller.setCaptureActive(true);
    expect(document.getElementById(FREEZE_SAFE_STYLE_ID)).not.toBeNull();
    engine.failUnfreeze = true;
    controller.setCaptureActive(false);
    expect(engine.unfreezeCalls).toBe(1);
    expect(document.getElementById(FREEZE_SAFE_STYLE_ID)).toBeNull();
    expect(controller.isFrozen()).toBe(false);
  });

  it("dispose unfreezes and removes styles (unmount/HMR/pagehide path)", () => {
    const engine = makeEngine();
    const controller = createCaptureFreezeController({ engine });
    controller.setCaptureActive(true);
    controller.dispose();
    expect(engine.unfreezeCalls).toBe(1);
    expect(controller.isFrozen()).toBe(false);
    expect(document.getElementById(FREEZE_SAFE_STYLE_ID)).toBeNull();
    // dispose is idempotent
    controller.dispose();
    expect(engine.unfreezeCalls).toBe(1);
  });
});

describe("frame hold", () => {
  it("queues page rAF callbacks while frozen and replays them on unfreeze", async () => {
    // Stub the window rAF so the controller's save/restore and replay are
    // observable (jsdom's own rAF never fires without pretendToBeVisual).
    const jsdomRaf = window.requestAnimationFrame;
    const jsdomCancelRaf = window.cancelAnimationFrame;
    const replayed: FrameRequestCallback[] = [];
    let nextHandle = 1;
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      replayed.push(callback);
      return nextHandle++;
    };
    window.cancelAnimationFrame = () => undefined;
    try {
      const engine = {
        freeze: () => undefined,
        unfreeze: () => undefined,
        isFrozen: () => false,
      };
      const controller = createCaptureFreezeController({ engine });
      let ran = 0;
      controller.setCaptureActive(true);
      // Frozen: new rAF registrations are held, not executed.
      window.requestAnimationFrame(() => {
        ran += 1;
      });
      window.requestAnimationFrame(() => {
        ran += 1;
      });
      expect(ran).toBe(0);
      // While frozen, cancelAnimationFrame unregisters a held callback.
      const heldHandle = window.requestAnimationFrame(() => {
        ran += 1;
      });
      window.cancelAnimationFrame(heldHandle);
      controller.setCaptureActive(false);
      expect(ran).toBe(0); // replayed through the restored stub rAF
      expect(replayed.length).toBe(2); // cancelled frame is not replayed
      expect(replayed[0]).toBeTypeOf("function");
      // A later freeze cycle holds nothing (no cross-cycle leakage).
      controller.setCaptureActive(true);
      controller.setCaptureActive(false);
      expect(replayed.length).toBe(2);
    } finally {
      window.requestAnimationFrame = jsdomRaf;
      window.cancelAnimationFrame = jsdomCancelRaf;
    }
  });

  it("restores the original rAF functions exactly once per cycle", () => {
    const engine = {
      freeze: () => undefined,
      unfreeze: () => undefined,
      isFrozen: () => false,
    };
    const controller = createCaptureFreezeController({ engine });
    const original = window.requestAnimationFrame;
    const originalCancel = window.cancelAnimationFrame;
    controller.setCaptureActive(true);
    expect(window.requestAnimationFrame).not.toBe(original);
    controller.setCaptureActive(true); // idempotent
    controller.setCaptureActive(false);
    controller.setCaptureActive(false); // idempotent
    expect(window.requestAnimationFrame).toBe(original);
    expect(window.cancelAnimationFrame).toBe(originalCancel);
  });
});

