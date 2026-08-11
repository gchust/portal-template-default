import { describe, expect, it } from "vitest";

import {
  extractAccessibleName,
  extractFingerprint,
  extractIdentityAttributes,
  normalizeComparedText,
  normalizeInspectedElement,
  normalizeSource,
  normalizeSourceFrame,
  redactInspectionText,
  sanitizeViewportRect,
  toWorkspaceRelativePosix,
} from "@/studio/inspection";
import { InspectionError } from "@/studio/inspection";

const RAW_BASE = {
  htmlPreview: "<button>Save</button>",
  stack: [] as Array<{ fileName?: string; lineNumber?: number; columnNumber?: number; functionName?: string }>,
  componentName: null,
  filePath: null,
  lineNumber: null,
  columnNumber: null,
  selector: "#save",
  styles: "color: red;",
};

const makeElement = (): HTMLElement => {
  const button = document.createElement("button");
  button.id = "save";
  button.textContent = "Save";
  document.body.append(button);
  return button;
};

describe("toWorkspaceRelativePosix", () => {
  it("keeps already-relative POSIX paths", () => {
    expect(toWorkspaceRelativePosix("fixture.tsx")).toBe("fixture.tsx");
    expect(toWorkspaceRelativePosix("src/studio/toolbar.tsx")).toBe(
      "src/studio/toolbar.tsx"
    );
  });

  it("strips a leading slash to make a workspace-relative path", () => {
    expect(toWorkspaceRelativePosix("/src/components/Button.tsx")).toBe(
      "src/components/Button.tsx"
    );
  });

  it("strips a Windows drive prefix and normalizes backslashes", () => {
    expect(toWorkspaceRelativePosix("C:\\dev\\app\\src\\x.tsx")).toBe(
      "dev/app/src/x.tsx"
    );
  });

  it("omits node_modules, external URLs, traversal and empty paths", () => {
    expect(toWorkspaceRelativePosix("node_modules/react/index.js")).toBeNull();
    expect(toWorkspaceRelativePosix("/app/node_modules/x/y.js")).toBeNull();
    expect(toWorkspaceRelativePosix("https://cdn.example.com/app.js")).toBeNull();
    expect(toWorkspaceRelativePosix("../outside.tsx")).toBeNull();
    expect(toWorkspaceRelativePosix("a/../../b.ts")).toBeNull();
    expect(toWorkspaceRelativePosix("")).toBeNull();
    expect(toWorkspaceRelativePosix(null)).toBeNull();
  });
});

describe("normalizeSource / normalizeSourceFrame", () => {
  it("returns null when the upstream source location is absent", () => {
    expect(
      normalizeSource(null, null, null, null)
    ).toBeNull();
    expect(
      normalizeSource("src/x.tsx", null, 3, "X")
    ).toBeNull();
  });

  it("validates line/column bounds", () => {
    expect(
      normalizeSource("src/x.tsx", 0, 0, "X")
    ).toBeNull();
    expect(
      normalizeSource("src/x.tsx", 12, -1, "X")
    ).toBeNull();
  });

  it("normalizes a valid source and bounds the component name", () => {
    const source = normalizeSource(
      "/src/x.tsx",
      12,
      4,
      "X".repeat(500)
    );
    expect(source).toEqual({
      filePath: "src/x.tsx",
      lineNumber: 12,
      columnNumber: 4,
      componentName: "X".repeat(200),
    });
  });

  it("drops frames without a workspace file or valid line/column", () => {
    expect(normalizeSourceFrame({ functionName: "button" })).toBeNull();
    expect(
      normalizeSourceFrame({ fileName: "node_modules/x.js", lineNumber: 1, columnNumber: 0 })
    ).toBeNull();
    expect(
      normalizeSourceFrame({ fileName: "fixture.tsx", lineNumber: 90, columnNumber: 9, functionName: "PlainButton" })
    ).toEqual({
      filePath: "fixture.tsx",
      lineNumber: 90,
      columnNumber: 9,
      componentName: "PlainButton",
    });
  });
});

describe("normalizeInspectedElement", () => {
  it("fails with a typed error when the selector is empty", () => {
    const element = makeElement();
    expect(() =>
      normalizeInspectedElement(
        element,
        { ...RAW_BASE, selector: "  " },
        { x: 0, y: 0, width: 10, height: 10 }
      )
    ).toThrowError(InspectionError);
  });

  it("fails with a typed error when the selector exceeds 4096 chars", () => {
    const element = makeElement();
    expect(() =>
      normalizeInspectedElement(
        element,
        { ...RAW_BASE, selector: "#x".repeat(3000) },
        { x: 0, y: 0, width: 10, height: 10 }
      )
    ).toThrowError(InspectionError);
  });

  it("returns a bounded v6 capture with honest source-null", () => {
    const element = makeElement();
    const inspected = normalizeInspectedElement(
      element,
      {
        ...RAW_BASE,
        htmlPreview: "x".repeat(9000),
        styles: "y".repeat(9000),
        stack: [
          { functionName: "button" },
          { functionName: "SaveButton", fileName: "src/save.tsx", lineNumber: 5, columnNumber: 2 },
        ],
      },
      { x: 1.5, y: 2.5, width: 100, height: 44 }
    );

    expect(inspected.selector).toBe("#save");
    expect(inspected.source).toBeNull();
    expect(inspected.sourceStack).toHaveLength(1);
    expect(inspected.sourceStack[0]).toEqual({
      filePath: "src/save.tsx",
      lineNumber: 5,
      columnNumber: 2,
      componentName: "SaveButton",
    });
    expect(inspected.htmlPreview).toHaveLength(4000);
    expect(inspected.styleText).toHaveLength(6000);
    expect(inspected.fingerprint.tagName).toBe("button");
    expect(inspected.fingerprint.text).toBe("Save");
    expect(inspected.fingerprint.identityAttributes).toEqual({ id: "save" });
    expect(inspected.fingerprint.childCount).toBe(0);
  });

  it("sanitizes non-finite bounds to zero and never throws", () => {
    const element = makeElement();
    const inspected = normalizeInspectedElement(
      element,
      RAW_BASE,
      { x: Number.NaN, y: Number.POSITIVE_INFINITY, width: -5, height: 44 }
    );
    expect(inspected.bounds).toEqual({ x: 0, y: 0, width: 0, height: 44 });
  });
});

describe("redaction and limits", () => {
  it("redacts secret-looking assignments", () => {
    expect(redactInspectionText("token=abc123", 4000)).toBe("token=[REDACTED]");
    expect(redactInspectionText("password: hunter2", 4000)).toBe("password=[REDACTED]");
    expect(redactInspectionText("api_key=xyz", 4000)).toBe("api_key=[REDACTED]");
  });

  it("truncates over-limit text", () => {
    expect(redactInspectionText("abc", 2)).toBe("ab");
  });

  it("normalizes compared text with caps", () => {
    expect(normalizeComparedText("  a\n  b  ", 500)).toBe("a b");
    expect(normalizeComparedText("abcdef", 3)).toBe("abc");
  });
});

describe("fingerprint extraction", () => {
  it("collects only id, data-ai-page-element and safe data-nb-* keys", () => {
    const element = document.createElement("button");
    element.id = "b1";
    element.setAttribute("data-ai-page-element", "pe-1");
    element.setAttribute("data-nb-resource", "users");
    element.setAttribute("data-nb-token", "secret-please-drop");
    element.setAttribute("class", "ignored");
    const attributes = extractIdentityAttributes(element);
    expect(attributes).toEqual({
      id: "b1",
      "data-ai-page-element": "pe-1",
      "data-nb-resource": "users",
    });
    expect(attributes["data-nb-token"]).toBeUndefined();
  });

  it("resolves accessible name in ARIA precedence order", () => {
    const container = document.createElement("div");
    const label = document.createElement("span");
    label.id = "lbl";
    label.textContent = "Named by label";
    container.append(label);
    const button = document.createElement("button");
    button.setAttribute("aria-labelledby", "lbl");
    button.setAttribute("aria-label", "named by aria-label");
    container.append(button);
    document.body.append(container);
    expect(extractAccessibleName(button)).toBe("Named by label");
    button.removeAttribute("aria-labelledby");
    expect(extractAccessibleName(button)).toBe("named by aria-label");
    button.removeAttribute("aria-label");
    button.setAttribute("alt", "named by alt");
    expect(extractAccessibleName(button)).toBe("named by alt");
    button.removeAttribute("alt");
    button.setAttribute("title", "named by title");
    expect(extractAccessibleName(button)).toBe("named by title");
    button.removeAttribute("title");
    expect(extractAccessibleName(button)).toBe("");
  });

  it("captures composed parent and caps text", () => {
    const section = document.createElement("section");
    const button = document.createElement("button");
    button.textContent = "word ".repeat(500);
    section.append(button);
    document.body.append(section);
    const fingerprint = extractFingerprint(button);
    expect(fingerprint.parent).toEqual({ tagName: "section", role: "" });
    expect(fingerprint.text.length).toBeLessThanOrEqual(1000);
  });
});

describe("sanitizeViewportRect", () => {
  it("bounds non-finite values", () => {
    expect(sanitizeViewportRect({ x: 1, y: 2, width: 3, height: 4 })).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
    expect(sanitizeViewportRect(undefined)).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    expect(sanitizeViewportRect({ x: Number.NaN, y: 2, width: -1, height: 4 })).toEqual({
      x: 0,
      y: 2,
      width: 0,
      height: 4,
    });
  });
});
