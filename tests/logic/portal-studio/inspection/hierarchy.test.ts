import { describe, expect, it } from "vitest";

import {
  composedParent,
  walkComposedAncestors,
} from "@/studio/inspection";

const alwaysIncluded = () => true;

describe("composedParent", () => {
  it("returns the light-DOM parent", () => {
    const parent = document.createElement("section");
    const child = document.createElement("button");
    parent.append(child);
    expect(composedParent(child)).toBe(parent);
  });

  it("returns the host when crossing an open shadow root", () => {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    const child = document.createElement("button");
    root.append(child);
    expect(composedParent(child)).toBe(host);
  });

  it("returns null at the top of the tree", () => {
    expect(composedParent(document.documentElement)).toBeNull();
  });
});

describe("walkComposedAncestors", () => {
  it("walks light-DOM ancestors with the inclusion predicate", () => {
    const main = document.createElement("main");
    const section = document.createElement("section");
    const button = document.createElement("button");
    section.append(button);
    main.append(section);
    document.body.append(main);

    const walk = walkComposedAncestors(button, {
      isIncluded: alwaysIncluded,
      maxDepth: 3,
    });
    expect(walk).toEqual([button, section, main]);
  });

  it("crosses an open shadow root boundary", () => {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    const button = document.createElement("button");
    root.append(button);
    document.body.append(host);

    const walk = walkComposedAncestors(button, {
      isIncluded: alwaysIncluded,
    });
    expect(walk[0]).toBe(button);
    expect(walk[1]).toBe(host);
  });

  it("stops at the first excluded ancestor", () => {
    const section = document.createElement("section");
    const button = document.createElement("button");
    section.append(button);
    document.body.append(section);

    const walk = walkComposedAncestors(button, {
      isIncluded: (element) => element !== section,
    });
    expect(walk).toEqual([button]);
  });

  it("respects the depth bound", () => {
    const main = document.createElement("main");
    const section = document.createElement("section");
    const button = document.createElement("button");
    section.append(button);
    main.append(section);
    document.body.append(main);

    const walk = walkComposedAncestors(button, {
      isIncluded: alwaysIncluded,
      maxDepth: 1,
    });
    expect(walk).toEqual([button]);
  });

  it("excludes a disconnected start element via the predicate", () => {
    const button = document.createElement("button");
    const walk = walkComposedAncestors(button, {
      isIncluded: (element) => element.isConnected,
    });
    expect(walk).toEqual([]);
  });
});
