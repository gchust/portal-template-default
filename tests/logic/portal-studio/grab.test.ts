import { describe, expect, it } from "vitest";

import {
  collectComponentChain,
  findFiberKey,
  readFiberTypeName,
} from "@/studio/grab";

type FiberMock = {
  tag: number;
  type: unknown;
  key?: unknown;
  return?: FiberMock | null;
};

const makeFiber = (type: unknown, key?: unknown): FiberMock => ({
  tag: typeof type === "string" ? 5 : 0,
  type,
  key,
});

const makeElementWithFiber = (fiber: FiberMock): Element => {
  const element = document.createElement("div");
  Object.defineProperty(element, "__reactFiber$mock", {
    value: fiber,
    enumerable: true,
    configurable: true,
  });
  return element;
};

describe("findFiberKey", () => {
  it("finds the React 19 fiber key on an element", () => {
    const element = makeElementWithFiber(makeFiber("div"));
    expect(findFiberKey(element)).toBe("__reactFiber$mock");
  });

  it("returns undefined for plain elements", () => {
    expect(findFiberKey(document.createElement("span"))).toBeUndefined();
  });
});

describe("readFiberTypeName", () => {
  it("reads host tags, display names, and function names", () => {
    expect(readFiberTypeName("tr")).toBe("tr");
    expect(readFiberTypeName({ displayName: "TableRow" })).toBe("TableRow");
    expect(readFiberTypeName({ name: "DataTable" })).toBe("DataTable");
    expect(
      readFiberTypeName(function UserListRoute() {
        return null;
      })
    ).toBe("UserListRoute");
    expect(readFiberTypeName(undefined)).toBeNull();
    expect(readFiberTypeName(42)).toBeNull();
  });
});

describe("collectComponentChain", () => {
  it("walks the return chain and collapses duplicates", () => {
    const chain = makeFiber("Layout", null);
    chain.return = makeFiber("div", null);
    chain.return.return = makeFiber("SidebarProvider", null);
    chain.return.return.return = makeFiber("SidebarProvider", null);
    chain.return.return.return.return = makeFiber("Header", null);

    const element = makeElementWithFiber(chain);
    const candidates = collectComponentChain(element);
    expect(candidates.map((candidate) => candidate.name)).toEqual([
      "Layout",
      "div",
      "SidebarProvider",
      "Header",
    ]);
  });

  it("records fiber keys when present", () => {
    const chain = makeFiber("TableRow", "row-1");
    const element = makeElementWithFiber(chain);
    const candidates = collectComponentChain(element);
    expect(candidates[0]).toEqual({ name: "TableRow", key: "row-1" });
  });

  it("fails closed without a fiber key", () => {
    expect(
      collectComponentChain(document.createElement("div"))
    ).toEqual([]);
  });

  it("fails closed on malformed fibers", () => {
    const element = document.createElement("div");
    Object.defineProperty(element, "__reactFiber$bad", {
      value: { get return() { throw new Error("boom"); } },
      enumerable: true,
      configurable: true,
    });
    expect(collectComponentChain(element)).toEqual([]);
  });

  it("bounds depth", () => {
    const head = makeFiber("Top", null);
    let cursor = head;
    for (let index = 0; index < 10; index += 1) {
      cursor.return = makeFiber(`C${index}`, null);
      cursor = cursor.return;
    }
    const element = makeElementWithFiber(head);
    expect(collectComponentChain(element, 5)).toHaveLength(5);
  });
});
