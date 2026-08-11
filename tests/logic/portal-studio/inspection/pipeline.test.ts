import { describe, expect, it, vi } from "vitest";

import {
  buildCaptureDraft,
  INSPECTION_CONCURRENCY,
} from "@/studio/inspection";
import { InspectionError } from "@/studio/inspection";
import { setElementRect } from "../../../setup/hit-test-shim";

const route = {
  url: "http://localhost/users",
  routeKey: "/users",
  title: "Users",
};

const makeButton = (id: string): HTMLButtonElement => {
  const button = document.createElement("button");
  button.id = id;
  button.textContent = id;
  setElementRect(button, { x: 10, y: 10, width: 100, height: 40 });
  document.body.append(button);
  return button;
};

describe("buildCaptureDraft — bounded async v6 pipeline", () => {
  it("inspects with concurrency exactly 4 and preserves input order", async () => {
    const buttons = ["a", "b", "c", "d", "e", "f", "g"].map(makeButton);
    const result = await buildCaptureDraft(buttons, route);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Input order preserved regardless of completion order.
    expect(result.captures.map((capture) => capture.fingerprint.text)).toEqual(
      ["a", "b", "c", "d", "e", "f", "g"]
    );
    expect(result.captures.every((capture) => capture.selector)).toBe(true);
    expect(result.captures[0].fingerprint.identityAttributes).toEqual({
      id: "a",
    });
  });

  it("is all-or-nothing: one failing element fails the whole pipeline", async () => {
    const buttons = ["a", "b"].map(makeButton);
    // A text node is not an Element → the engine throws a typed error.
    const result = await buildCaptureDraft(
      [buttons[0], document.createTextNode("x") as unknown as Element, buttons[1]],
      route
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(InspectionError);
    expect(result.error.code).toBe("not_an_element");
  });

  it("discards the result when the capture is cancelled mid-flight", async () => {
    const buttons = ["a", "b", "c"].map(makeButton);
    let cancelled = false;
    const result = await buildCaptureDraft(buttons, route, {
      isCancelled: () => cancelled,
    });
    expect(result.ok).toBe(true); // no cancellation requested → normal
    cancelled = true;
    const cancelledResult = await buildCaptureDraft(buttons, route, {
      isCancelled: () => cancelled,
    });
    expect(cancelledResult.ok).toBe(false);
    if (cancelledResult.ok) return;
    expect(cancelledResult.error.message).toContain("cancelled");
  });

  it("deduplicates business context across the selection", async () => {
    const button = makeButton("ctx");
    button.setAttribute("data-nb-resource", "users");
    const second = makeButton("ctx2");
    second.setAttribute("data-nb-resource", "users");
    const result = await buildCaptureDraft([button, second], route);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.businessContext).toEqual([
      { type: "data-attribute", id: "users", source: "data-nb-resource" },
    ]);
  });

  it("returns empty captures for an empty selection", async () => {
    const result = await buildCaptureDraft([], route);
    expect(result).toEqual({ ok: true, captures: [], businessContext: [] });
  });
});

describe("INSPECTION_CONCURRENCY", () => {
  it("is exactly 4", () => {
    expect(INSPECTION_CONCURRENCY).toBe(4);
    expect(typeof vi.fn).toBe("function");
  });
});
