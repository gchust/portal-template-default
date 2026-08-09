import { describe, expect, it } from "vitest";

import {
  captureElement,
  captureSelection,
  collectBusinessContext,
  collectComputedStyleExcerpt,
  collectDomOutline,
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

describe("collectSelectorCandidates (D-044)", () => {
  it("CSS-escapes the first class in the path candidate (D-044)", () => {
    document.body.innerHTML = `
      <div class="flex gap-2"><button class="group/button inline-flex">Sort</button></div>`;
    const button = document.querySelector("button")!;
    const candidates = collectSelectorCandidates(button);
    const path = candidates.find((candidate) => candidate.kind === "path");
    expect(path).toBeDefined();
    // The slash class must be escaped so the selector is VALID.
    expect(path!.selector).toContain("button.group\\/button");
    // And it must actually resolve without throwing.
    expect(() => document.querySelector(path!.selector)).not.toThrow();
    expect(document.querySelector(path!.selector)).toBe(button);
  });

  it("still produces plain path candidates for normal classes", () => {
    document.body.innerHTML = `<div class="row"><span class="cell">x</span></div>`;
    const span = document.querySelector("span")!;
    const plain = collectSelectorCandidates(span);
    expect(
      plain.find((candidate) => candidate.kind === "path")!.selector
    ).toBe("body > div.row > span.cell");
  });
});

describe("dom outline and computed styles", () => {
  it("builds a bounded outline with id, classes, and role", () => {
    document.body.innerHTML = `<button id="save" class="btn primary" role="button">Save</button>`;
    const button = document.querySelector("button")!;
    const outline = collectDomOutline(button);
    expect(outline).toContain("button");
    expect(outline).toContain("#save");
    expect(outline).toContain(".btn");
    expect(outline).toContain("[role=");
    expect(outline.length).toBeLessThanOrEqual(160);
  });

  it("collects a bounded, redacted computed-style excerpt", () => {
    document.body.innerHTML = `<button style="color: rgb(1, 2, 3); display: inline-flex">Save</button>`;
    const button = document.querySelector("button")!;
    const excerpt = collectComputedStyleExcerpt(button);
    expect(excerpt.color).toBe("rgb(1, 2, 3)");
    expect(Object.keys(excerpt).length).toBeLessThanOrEqual(30);
    for (const value of Object.values(excerpt)) {
      expect(value.length).toBeLessThanOrEqual(200);
    }
  });
});

describe("business context", () => {
  it("extracts page-element and data-nb-* items, deduped and bounded", () => {
    document.body.innerHTML = `
      <div data-ai-page-element="pe-1" data-nb-block="block-a">
        <button data-ai-page-element="pe-1" data-nb-field="field-1">Go</button>
      </div>`;
    const button = document.querySelector("button")!;
    const items = collectBusinessContext(button);
    const keys = items.map((item) => `${item.type}:${item.id}:${item.source}`);
    expect(keys).toContain("page-element:pe-1:data-ai-page-element");
    expect(keys).toContain("data-attribute:block-a:data-nb-block");
    expect(keys).toContain("data-attribute:field-1:data-nb-field");
    expect(new Set(keys).size).toBe(keys.length);
    expect(items.length).toBeLessThanOrEqual(20);
  });

  it("returns an empty list on context-free pages", () => {
    document.body.innerHTML = `<div><p>plain</p></div>`;
    expect(collectBusinessContext(document.querySelector("p")!)).toEqual([]);
  });
});

describe("captureElement / captureSelection", () => {
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
    expect(capture.snapshot.domOutline).toContain("button");
    expect(capture.snapshot.computedStyle).toBeDefined();
    expect(JSON.stringify(capture)).not.toContain("secret-value");
    expect(capture.componentCandidates).toEqual([]);
  });

  it("captures a multi-selection with deduped business context", () => {
    document.body.innerHTML = `
      <div data-ai-page-element="pe-1">
        <button id="a">A</button><button id="b">B</button>
      </div>`;
    const [a, b] = document.querySelectorAll("button");
    const result = captureSelection([a, b], {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    expect(result.elements).toHaveLength(2);
    expect(result.elements[0].snapshot.domOutline).toContain("#a");
    expect(result.elements[1].snapshot.domOutline).toContain("#b");
    expect(result.businessContext).toHaveLength(1);
    expect(result.businessContext[0]).toEqual({
      type: "page-element",
      id: "pe-1",
      source: "data-ai-page-element",
    });
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
