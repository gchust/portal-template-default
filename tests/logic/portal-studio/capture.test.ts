import { describe, expect, it } from "vitest";

import {
  captureElement,
  collectSelectorCandidates,
  collectTargetStack,
  isStudioElement,
} from "@/studio/capture";

describe("collectSelectorCandidates", () => {
  it("prefers id, page-element attribute, role, then a bounded path", () => {
    document.body.innerHTML = `
      <div id="page" role="main">
        <table><tbody><tr id="row-1" data-ai-page-element="pe-42"><td>Alice</td></tr></tbody></table>
      </div>`;
    const row = document.querySelector("tr")!;
    const candidates = collectSelectorCandidates(row);
    expect(candidates[0]).toEqual({ kind: "id", selector: "#row-1" });
    expect(candidates[1]).toEqual({
      kind: "attribute",
      selector: '[data-ai-page-element="pe-42"]',
    });
    expect(candidates.some((candidate) => candidate.kind === "path")).toBe(
      true
    );
    expect(candidates.length).toBeLessThanOrEqual(4);
  });
});

describe("captureElement", () => {
  it("captures a redacted snapshot with no secrets", () => {
    document.body.innerHTML = `
      <button class="save" data-token="secret-value">Save with Bearer abc123</button>`;
    const button = document.querySelector("button")!;
    const capture = captureElement(button);
    expect(capture.tagName).toBe("button");
    expect(capture.snapshot.attributes.class).toBe("save");
    expect(capture.snapshot.attributes["data-token"]).toBeUndefined();
    expect(capture.snapshot.text).toContain("[REDACTED]");
    expect(capture.snapshot.text).not.toContain("abc123");
    expect(JSON.stringify(capture)).not.toContain("secret-value");
    expect(capture.componentCandidates).toEqual([]);
  });
});

describe("isStudioElement / collectTargetStack", () => {
  it("excludes studio-owned elements from target stacks", () => {
    const studio = document.createElement("div");
    studio.id = "portal-studio-root";
    const inside = document.createElement("button");
    studio.appendChild(inside);
    document.body.appendChild(studio);

    expect(isStudioElement(inside)).toBe(true);
    expect(isStudioElement(studio)).toBe(true);
    expect(isStudioElement(document.body)).toBe(false);

    const page = document.createElement("button");
    document.body.appendChild(page);
    const stack = collectTargetStack(page, 4);
    expect(stack[0]).toBe(page);
    expect(stack.some((element) => element === studio)).toBe(false);

    expect(collectTargetStack(inside, 4)).toEqual([]);
  });
});
