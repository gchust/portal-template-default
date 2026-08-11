import { describe, expect, it } from "vitest";

import {
  boundRouteContext,
  collectInspectionBusinessContext,
  enrichInspectedElement,
} from "@/studio/inspection";
import type { InspectedElement, RouteContext } from "@/studio/inspection";

const inspected: InspectedElement = {
  tagName: "button",
  selector: "#save",
  bounds: { x: 0, y: 0, width: 100, height: 44 },
  componentName: null,
  source: null,
  sourceStack: [],
  htmlPreview: "<button>Save</button>",
  styleText: "",
  fingerprint: {
    tagName: "button",
    role: "",
    accessibleName: "",
    text: "Save",
    identityAttributes: { id: "save" },
    childCount: 0,
    parent: { tagName: "section", role: "" },
  },
};

const route: RouteContext = {
  url: "http://localhost/x/main/users",
  routeKey: "/x/main/users",
  title: "Users",
};

describe("collectInspectionBusinessContext", () => {
  it("collects bounded deduplicated page-element and data-nb-* hints", () => {
    document.body.innerHTML = "";
    const section = document.createElement("section");
    section.setAttribute("data-nb-resource", "users");
    const button = document.createElement("button");
    button.setAttribute("data-ai-page-element", "pe-42");
    button.setAttribute("data-nb-field", "nickname");
    button.setAttribute("data-nb-field", "nickname");
    section.append(button);
    document.body.append(section);

    const items = collectInspectionBusinessContext(button);
    expect(items).toEqual([
      { type: "page-element", id: "pe-42", source: "data-ai-page-element" },
      { type: "data-attribute", id: "nickname", source: "data-nb-field" },
      { type: "data-attribute", id: "users", source: "data-nb-resource" },
    ]);
  });

  it("bounds the item count and value lengths", () => {
    document.body.innerHTML = "";
    const button = document.createElement("button");
    for (let index = 0; index < 50; index += 1) {
      button.setAttribute(`data-nb-attr-${index}`, "x".repeat(500));
    }
    document.body.append(button);
    const items = collectInspectionBusinessContext(button);
    expect(items.length).toBe(20);
    expect(items.every((item) => (item.id?.length ?? 0) <= 200)).toBe(true);
  });

  it("walks up to three composed ancestors", () => {
    document.body.innerHTML = "";
    const outer = document.createElement("main");
    outer.setAttribute("data-nb-resource", "outer");
    const section = document.createElement("section");
    section.setAttribute("data-nb-resource", "section");
    const button = document.createElement("button");
    button.setAttribute("data-nb-resource", "button");
    section.append(button);
    outer.append(section);
    document.body.append(outer);

    const items = collectInspectionBusinessContext(button);
    const sources = items.map((item) => item.id);
    // The walk covers the element plus two composed ancestors (depth < 3),
    // matching the product convention: button, section, outer.
    expect(sources).toEqual(["button", "section", "outer"]);
  });
});

describe("enrichInspectedElement", () => {
  it("merges inspected data with bounded business context and route", () => {
    document.body.innerHTML = "";
    const button = document.createElement("button");
    button.setAttribute("data-nb-resource", "users");
    document.body.append(button);

    const enriched = enrichInspectedElement(button, inspected, route);
    expect(enriched.tagName).toBe("button");
    expect(enriched.selector).toBe("#save");
    expect(enriched.businessContext).toEqual([
      { type: "data-attribute", id: "users", source: "data-nb-resource" },
    ]);
    expect(enriched.route).toEqual(route);
  });

  it("bounds route fields", () => {
    document.body.innerHTML = "";
    const button = document.createElement("button");
    document.body.append(button);
    const enriched = enrichInspectedElement(button, inspected, {
      url: "u".repeat(5000),
      routeKey: "k".repeat(2000),
      title: "t".repeat(2000),
    });
    expect(enriched.route.url.length).toBe(2000);
    expect(enriched.route.routeKey.length).toBe(512);
    expect(enriched.route.title.length).toBe(500);
  });

  it("normalizes a route context deterministically", () => {
    expect(boundRouteContext(route)).toEqual(route);
  });
});
