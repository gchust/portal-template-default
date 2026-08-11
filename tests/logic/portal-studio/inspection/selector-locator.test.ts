import { describe, expect, it } from "vitest";

import {
  parseSelectorSegments,
  resolveSelector,
  scoreFingerprint,
} from "@/studio/inspection";
import type { ElementFingerprint } from "@/studio/inspection";

/** Build a live DOM mirroring the fingerprint-able fixture shapes. */
const buildDom = () => {
  document.body.innerHTML = "";

  const section = document.createElement("section");
  section.id = "section-a";

  const button = document.createElement("button");
  button.id = "save-button";
  button.textContent = "Save";
  button.setAttribute("aria-label", "Save changes");
  section.append(button);

  const second = document.createElement("button");
  second.className = "duplicate";
  second.textContent = "A";
  const third = document.createElement("button");
  third.className = "duplicate";
  third.textContent = "B";
  section.append(second, third);

  const host = document.createElement("div");
  host.id = "shadow-host";
  const shadowRoot = host.attachShadow({ mode: "open" });
  const shadowButton = document.createElement("button");
  shadowButton.id = "shadow-button";
  shadowButton.textContent = "Shadow";
  shadowRoot.append(shadowButton);

  const closedHost = document.createElement("div");
  closedHost.id = "closed-host";
  const closedRoot = closedHost.attachShadow({ mode: "closed" });
  const closedButton = document.createElement("button");
  closedButton.id = "closed-button";
  closedRoot.append(closedButton);

  const iframe = document.createElement("iframe");
  iframe.id = "frame";
  document.body.append(iframe);
  const frameDocument = iframe.contentDocument;
  if (frameDocument) {
    frameDocument.body.innerHTML = "";
    const frameButton = document.createElement("button");
    frameButton.id = "frame-button";
    frameButton.textContent = "Frame";
    frameDocument.body.append(frameButton);
  }

  const studioHost = document.createElement("div");
  studioHost.id = "portal-studio-root";
  studioHost.setAttribute("data-react-grab-ignore", "");
  const studioButton = document.createElement("button");
  studioButton.id = "studio-button";
  studioHost.append(studioButton);

  document.body.append(section, host, closedHost, studioHost);

  return {
    button,
    second,
    third,
    host,
    shadowButton,
    closedHost,
    frameButton: iframe.contentDocument?.getElementById("frame-button") ?? null,
    studioButton,
  };
};

const fingerprintOf = (element: Element | null): ElementFingerprint => {
  if (!element) throw new Error("missing element for fingerprint");
  const tagName = element.tagName.toLowerCase();
  const parent = element.parentElement;
  return {
    tagName,
    role: (element.getAttribute("role") ?? "").trim(),
    accessibleName: (element.getAttribute("aria-label") ?? "").trim(),
    text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
    identityAttributes: element.id
      ? { id: element.id }
      : {},
    childCount: element.children.length,
    parent: parent
      ? {
          tagName: parent.tagName.toLowerCase(),
          role: (parent.getAttribute("role") ?? "").trim(),
        }
      : { tagName: "", role: "" },
  };
};

const noIdentityFingerprint = (element: Element | null): ElementFingerprint => {
  const fingerprint = fingerprintOf(element);
  return { ...fingerprint, identityAttributes: {} };
};

describe("parseSelectorSegments", () => {
  it("parses ordinary, shadow and iframe boundary selectors", () => {
    expect(parseSelectorSegments("#a")).toEqual([{ kind: "css", css: "#a" }]);
    expect(parseSelectorSegments("#a >>> #b")).toEqual([
      { kind: "css", css: "#a" },
      { kind: "boundary", boundary: "shadow" },
      { kind: "css", css: "#b" },
    ]);
    expect(parseSelectorSegments("#a >>iframe>> #b")).toEqual([
      { kind: "css", css: "#a" },
      { kind: "boundary", boundary: "iframe" },
      { kind: "css", css: "#b" },
    ]);
    expect(parseSelectorSegments("#a >>> #b >>iframe>> #c")).toEqual([
      { kind: "css", css: "#a" },
      { kind: "boundary", boundary: "shadow" },
      { kind: "css", css: "#b" },
      { kind: "boundary", boundary: "iframe" },
      { kind: "css", css: "#c" },
    ]);
  });

  it("rejects empty, over-limit and malformed selectors", () => {
    expect(parseSelectorSegments("")).toBeNull();
    expect(parseSelectorSegments("   ")).toBeNull();
    expect(parseSelectorSegments("#x".repeat(3000))).toBeNull();
    expect(parseSelectorSegments(">>> #a")).toBeNull();
    expect(parseSelectorSegments("#a >>>")).toBeNull();
    expect(parseSelectorSegments("#a >>> >>iframe>> #b")).toBeNull();
  });
});

describe("resolveSelector — resolution rules", () => {
  it("resolves an ordinary selector with a matching fingerprint", () => {
    const dom = buildDom();
    const result = resolveSelector("#save-button", fingerprintOf(dom.button));
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.element).toBe(dom.button);
  });

  it("reports missing when a segment matches nothing", () => {
    const dom = buildDom();
    const result = resolveSelector("#does-not-exist", fingerprintOf(dom.button));
    expect(result).toEqual({
      status: "missing",
      reason: expect.stringContaining("matched nothing"),
    });
  });

  it("reports ambiguous instead of choosing the first match", () => {
    const dom = buildDom();
    const result = resolveSelector(".duplicate", fingerprintOf(dom.second));
    expect(result.status).toBe("ambiguous");
    expect(result).toEqual({
      status: "ambiguous",
      reason: expect.stringContaining("matched 2 elements"),
    });
  });

  it("crosses an open shadow root", () => {
    const dom = buildDom();
    const result = resolveSelector(
      "#shadow-host >>> #shadow-button",
      fingerprintOf(dom.shadowButton)
    );
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.element).toBe(dom.shadowButton);
    }
  });

  it("reports unsupported_boundary for a closed shadow root", () => {
    const dom = buildDom();
    const result = resolveSelector(
      "#closed-host >>> #closed-button",
      fingerprintOf(dom.closedHost)
    );
    expect(result.status).toBe("unsupported_boundary");
    expect(result).toEqual({
      status: "unsupported_boundary",
      reason: expect.stringContaining("no open shadowRoot"),
    });
  });

  it("crosses a same-origin iframe document", () => {
    const dom = buildDom();
    const result = resolveSelector(
      "#frame >>iframe>> #frame-button",
      fingerprintOf(dom.frameButton)
    );
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.element).toBe(dom.frameButton);
    }
  });

  it("reports unsupported_boundary when the iframe document is unavailable", () => {
    const dom = buildDom();
    const iframe = document.createElement("iframe");
    iframe.id = "fake-cross-origin-frame";
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      get() {
        throw new DOMException("Blocked a frame", "SecurityError");
      },
    });
    document.body.append(iframe);
    const result = resolveSelector(
      "#fake-cross-origin-frame >>iframe>> #anything",
      fingerprintOf(dom.button)
    );
    expect(result.status).toBe("unsupported_boundary");
    expect(result).toEqual({
      status: "unsupported_boundary",
      reason: expect.stringContaining("unavailable"),
    });
  });

  it("reports unsupported_boundary when the preceding element is not an iframe", () => {
    const dom = buildDom();
    const result = resolveSelector(
      "#save-button >>iframe>> #frame-button",
      fingerprintOf(dom.frameButton)
    );
    expect(result.status).toBe("unsupported_boundary");
    expect(result).toEqual({
      status: "unsupported_boundary",
      reason: expect.stringContaining("not an iframe"),
    });
  });

  it("never resolves inside the Studio host", () => {
    const dom = buildDom();
    const result = resolveSelector("#studio-button", fingerprintOf(dom.studioButton));
    expect(result.status).toBe("unsupported_boundary");
    expect(result).toEqual({
      status: "unsupported_boundary",
      reason: expect.stringContaining("Studio host"),
    });
  });

  it("reports invalid_selector for a broken CSS segment", () => {
    const dom = buildDom();
    const result = resolveSelector("#save-button >>>> #x", fingerprintOf(dom.button));
    // ">>>>" splits into ">>>" boundary plus "> #x" css — leading boundary after css is valid;
    // instead use a truly invalid css token:
    const broken = resolveSelector(":nope(", fingerprintOf(dom.button));
    expect(broken.status).toBe("invalid_selector");
    expect(result.status).not.toBe("resolved");
  });
});

describe("validateFingerprint — exact score matrix (shared contract §6)", () => {
  it("hard-fails on tagName mismatch", () => {
    const dom = buildDom();
    const fingerprint = fingerprintOf(dom.button);
    const verdict = scoreFingerprint(
      { ...fingerprint, tagName: "div" },
      dom.button
    );
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toContain("tagName mismatch");
  });

  it("accepts on exact strong identity attributes", () => {
    const dom = buildDom();
    const verdict = scoreFingerprint(fingerprintOf(dom.button), dom.button);
    expect(verdict.accepted).toBe(true);
    expect(verdict.reason).toContain("strong identity");
  });

  it("hard-fails when a strong identity value changed", () => {
    const dom = buildDom();
    const fingerprint = fingerprintOf(dom.button);
    dom.button.id = "other-id";
    const verdict = scoreFingerprint(fingerprint, dom.button);
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toContain("strong identity attribute changed");
  });

  it("hard-fails when a strong identity attribute is missing", () => {
    const dom = buildDom();
    const fingerprint = fingerprintOf(dom.button);
    dom.button.removeAttribute("id");
    const verdict = scoreFingerprint(fingerprint, dom.button);
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toContain("missing on live element");
  });

  it("scores role +2 exact non-empty, -4 changed", () => {
    const dom = buildDom();
    const base = noIdentityFingerprint(dom.button);
    dom.button.setAttribute("role", "button");
    const exact = scoreFingerprint({ ...base, role: "button" }, dom.button);
    expect(exact.accepted).toBe(true);
    expect(exact.score).toBe(2 + 3 + 3 + 1 + 1); // role+name+text+parent+child
    const changed = scoreFingerprint({ ...base, role: "tab" }, dom.button);
    expect(changed.score).toBe(-4 + 3 + 3 + 1 + 1);
    expect(changed.accepted).toBe(true); // 4 points with matched text signal
  });

  it("scores accessibleName +3 exact non-empty, -3 changed", () => {
    const dom = buildDom();
    const base = noIdentityFingerprint(dom.button);
    const exact = scoreFingerprint(
      { ...base, role: "", accessibleName: "Save changes" },
      dom.button
    );
    expect(exact.score).toBe(0 + 3 + 3 + 1 + 1);
    const changed = scoreFingerprint(
      { ...base, role: "", accessibleName: "Other label" },
      dom.button
    );
    expect(changed.score).toBe(0 - 3 + 3 + 1 + 1);
  });

  it("scores text +3 exact non-empty, -2 changed", () => {
    const dom = buildDom();
    const base = noIdentityFingerprint(dom.button);
    dom.button.removeAttribute("aria-label");
    const exact = scoreFingerprint({ ...base, accessibleName: "" }, dom.button);
    expect(exact.score).toBe(0 + 0 + 3 + 1 + 1);
    const changed = scoreFingerprint(
      { ...base, accessibleName: "", text: "Renamed" },
      dom.button
    );
    expect(changed.score).toBe(0 + 0 - 2 + 1 + 1);
  });

  it("scores parent +1 exact, -1 changed", () => {
    const dom = buildDom();
    const base = noIdentityFingerprint(dom.button);
    dom.button.removeAttribute("aria-label");
    const exact = scoreFingerprint(
      { ...base, accessibleName: "", parent: { tagName: "section", role: "" } },
      dom.button
    );
    expect(exact.score).toBe(0 + 0 + 3 + 1 + 1);
    const changed = scoreFingerprint(
      { ...base, accessibleName: "", parent: { tagName: "main", role: "" } },
      dom.button
    );
    expect(changed.score).toBe(0 + 0 + 3 - 1 + 1);
  });

  it("scores childCount +1 exact, 0 diff-one, -1 larger", () => {
    const dom = buildDom();
    const base = noIdentityFingerprint(dom.button);
    dom.button.removeAttribute("aria-label");
    const withoutChild = { ...base, accessibleName: "", childCount: 0 };
    const oneChild = { ...base, accessibleName: "", childCount: 1 };
    const manyChildren = { ...base, accessibleName: "", childCount: 5 };
    expect(scoreFingerprint(withoutChild, dom.button).score).toBe(0 + 0 + 3 + 1 + 1);
    expect(scoreFingerprint(oneChild, dom.button).score).toBe(0 + 0 + 3 + 1 + 0);
    expect(scoreFingerprint(manyChildren, dom.button).score).toBe(0 + 0 + 3 + 1 - 1);
  });

  it("rejects when the score is below 4 or no signal matched", () => {
    const dom = buildDom();
    const base = noIdentityFingerprint(dom.button);
    dom.button.removeAttribute("aria-label");
    // role changed (-4), text changed (-2), name empty-exact (0): -4-2+1+1 = -4
    const verdict = scoreFingerprint(
      { ...base, accessibleName: "", role: "tab", text: "Renamed" },
      dom.button
    );
    expect(verdict.accepted).toBe(false);
    expect(verdict.score).toBe(-4);
  });

  it("rejects a changed label even when structure matches (score < 4)", () => {
    const dom = buildDom();
    const base = noIdentityFingerprint(dom.button);
    dom.button.removeAttribute("aria-label");
    // only text matched (3) + parent (1) + child (1) = 5 — accepted;
    // now change the text only: 0 + 0 - 2 + 1 + 1 = 0
    const verdict = scoreFingerprint(
      { ...base, accessibleName: "", text: "Save" },
      dom.button
    );
    expect(verdict.accepted).toBe(true);
    expect(verdict.score).toBe(5);
    const changed = scoreFingerprint(
      { ...base, accessibleName: "", text: "Save now" },
      dom.button
    );
    expect(changed.accepted).toBe(false);
    expect(changed.score).toBe(0);
  });

  it("accepts the empty-semantic case only when parent and child count match", () => {
    const dom = buildDom();
    const iconButton = document.createElement("button");
    iconButton.id = "icon-btn";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    iconButton.append(svg);
    document.body.append(iconButton);
    const base = noIdentityFingerprint(iconButton);
    const empty = { ...base, role: "", accessibleName: "", text: "" };
    const match = scoreFingerprint(empty, iconButton);
    expect(match.accepted).toBe(true);
    expect(match.reason).toContain("no semantic signals");
    const childChanged = scoreFingerprint({ ...empty, childCount: 3 }, iconButton);
    expect(childChanged.accepted).toBe(false);
    const parentChanged = scoreFingerprint(
      { ...empty, parent: { tagName: "main", role: "" } },
      iconButton
    );
    expect(parentChanged.accepted).toBe(false);
  });

  it("applies the same whitespace/trim normalization as capture", () => {
    const dom = buildDom();
    const button = document.createElement("button");
    button.textContent = "  Multi\n   line  ";
    document.body.append(button);
    const base = noIdentityFingerprint(button);
    const fingerprint = { ...base, text: "Multi line" };
    const verdict = scoreFingerprint(fingerprint, button);
    expect(verdict.accepted).toBe(true);
  });
});
