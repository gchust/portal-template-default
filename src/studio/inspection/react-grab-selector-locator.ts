/**
 * Portal Studio — strict React Grab selector locator (marker rehydration).
 *
 * Resolves and validates the ONE public selector produced by React Grab
 * (shared contract §6). It is part of annotation persistence, NOT a second
 * perception engine: it never generates alternatives, scans Fiber, searches
 * source modules, or performs fuzzy page-wide matching. A mismatch returns a
 * typed unresolved result; the first vague match is never chosen.
 *
 * Selector syntax:
 * - ordinary CSS segments, resolved with `querySelectorAll` (exactly one
 *   match per segment);
 * - `>>>` enters the open `shadowRoot` of the uniquely resolved host;
 * - `>>iframe>>` enters the accessible same-origin `contentDocument` of the
 *   uniquely resolved iframe.
 *
 * Fingerprint validation follows the exact deterministic algorithm of shared
 * contract §6: tagName hard match, strong identity attributes hard match,
 * then the bounded score with thresholds and the empty-semantic case.
 */

import { isStudioElement } from "./react-grab-engine";
import { composedParent } from "./hierarchy";
import {
  extractAccessibleName,
  normalizeComparedText,
} from "./normalize";
import {
  INSPECTION_ACCESSIBLE_NAME_LIMIT,
  INSPECTION_IDENTITY_VALUE_LIMIT,
  INSPECTION_ROLE_LIMIT,
  INSPECTION_SELECTOR_LIMIT,
  INSPECTION_TEXT_LIMIT,
} from "./types";
import type { ElementFingerprint } from "./types";

export type SelectorStatus =
  | "resolved"
  | "missing"
  | "ambiguous"
  | "unsupported_boundary"
  | "fingerprint_mismatch"
  | "invalid_selector";

export type SelectorResolution =
  | { status: "resolved"; element: Element }
  | { status: Exclude<SelectorStatus, "resolved">; reason: string };

type SelectorSegment =
  | { kind: "css"; css: string }
  | { kind: "boundary"; boundary: "shadow" | "iframe" };

const BOUNDARY_PATTERN = /(>>>|>>iframe>>)/;

/**
 * Parse a React Grab selector into alternating CSS/boundary segments.
 * Returns null for empty, over-limit, or malformed selectors (leading or
 * trailing boundary, consecutive boundaries).
 */
export function parseSelectorSegments(
  selector: string
): SelectorSegment[] | null {
  if (!selector) return null;
  if (selector.length > INSPECTION_SELECTOR_LIMIT) return null;
  const tokens = selector
    .split(BOUNDARY_PATTERN)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  const segments: SelectorSegment[] = [];
  for (const token of tokens) {
    if (token === ">>>") {
      segments.push({ kind: "boundary", boundary: "shadow" });
    } else if (token === ">>iframe>>") {
      segments.push({ kind: "boundary", boundary: "iframe" });
    } else {
      segments.push({ kind: "css", css: token });
    }
  }
  let expectCss = true;
  for (const segment of segments) {
    if (segment.kind === "css" !== expectCss) return null;
    expectCss = !expectCss;
  }
  if (expectCss) return null; // last segment was a boundary without a following segment
  return segments;
}

const resolveInRoot = (
  root: Document | ShadowRoot,
  css: string
): SelectorResolution | null => {
  let matches: NodeListOf<Element>;
  try {
    matches = root.querySelectorAll(css);
  } catch {
    return { status: "invalid_selector", reason: `CSS segment is invalid: ${css}` };
  }
  if (matches.length === 0) {
    return { status: "missing", reason: `segment matched nothing: ${css}` };
  }
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      reason: `segment matched ${matches.length} elements: ${css}`,
    };
  }
  return null;
};

/**
 * Resolve a React Grab selector and validate it against the captured
 * fingerprint. Never throws; every failure is a typed unresolved result.
 */
export function resolveSelector(
  selector: string,
  fingerprint: ElementFingerprint
): SelectorResolution {
  const segments = parseSelectorSegments(selector);
  if (!segments) {
    return {
      status: "invalid_selector",
      reason: "selector is empty, over-limit, or malformed",
    };
  }
  let root: Document | ShadowRoot = document;
  let current: Element | null = null;
  for (const segment of segments) {
    if (segment.kind === "boundary") {
      if (segment.boundary === "shadow") {
        if (!current || !current.shadowRoot) {
          return {
            status: "unsupported_boundary",
            reason: "preceding element has no open shadowRoot",
          };
        }
        root = current.shadowRoot;
      } else {
        if (!(current instanceof HTMLIFrameElement)) {
          return {
            status: "unsupported_boundary",
            reason: "preceding element is not an iframe",
          };
        }
        let contentDocument: Document | null = null;
        try {
          contentDocument = current.contentDocument;
        } catch {
          contentDocument = null;
        }
        if (!contentDocument) {
          return {
            status: "unsupported_boundary",
            reason:
              "iframe contentDocument is unavailable (cross-origin or detached)",
          };
        }
        root = contentDocument;
      }
      continue;
    }
    const failure = resolveInRoot(root, segment.css);
    if (failure) return failure;
    current = root.querySelectorAll(segment.css)[0] ?? null;
  }
  if (!current) {
    return { status: "invalid_selector", reason: "selector resolved nothing" };
  }
  if (!current.isConnected) {
    return { status: "missing", reason: "resolved element is disconnected" };
  }
  if (isStudioElement(current)) {
    return {
      status: "unsupported_boundary",
      reason: "resolved element is inside the Studio host",
    };
  }
  return validateFingerprint(fingerprint, current);
}

export type FingerprintVerdict = {
  accepted: boolean;
  score: number;
  matchedNonEmptySignal: boolean;
  reason: string;
};

/**
 * Exact deterministic fingerprint validation (shared contract §6). All
 * compared text is trimmed, whitespace-collapsed, and bounded with the same
 * limits used at capture time.
 */
export function validateFingerprint(
  captured: ElementFingerprint,
  live: Element
): SelectorResolution {
  const verdict = scoreFingerprint(captured, live);
  return verdict.accepted
    ? { status: "resolved", element: live }
    : { status: "fingerprint_mismatch", reason: verdict.reason };
}

/** Pure scoring core, exported for exhaustive unit coverage. */
export function scoreFingerprint(
  captured: ElementFingerprint,
  live: Element
): FingerprintVerdict {
  const liveTagName = live.tagName.toLowerCase();
  if (liveTagName !== captured.tagName) {
    return {
      accepted: false,
      score: 0,
      matchedNonEmptySignal: false,
      reason: `tagName mismatch (captured ${captured.tagName}, live ${liveTagName})`,
    };
  }

  const strongKeys = Object.keys(captured.identityAttributes);
  if (strongKeys.length > 0) {
    for (const key of strongKeys) {
      const liveValue = live.getAttribute(key);
      const capturedValue = normalizeComparedText(
        captured.identityAttributes[key] ?? "",
        INSPECTION_IDENTITY_VALUE_LIMIT
      );
      if (liveValue === null) {
        return {
          accepted: false,
          score: 0,
          matchedNonEmptySignal: false,
          reason: `strong identity attribute missing on live element: ${key}`,
        };
      }
      if (normalizeComparedText(liveValue, INSPECTION_IDENTITY_VALUE_LIMIT) !== capturedValue) {
        return {
          accepted: false,
          score: 0,
          matchedNonEmptySignal: false,
          reason: `strong identity attribute changed: ${key}`,
        };
      }
    }
    return {
      accepted: true,
      score: 0,
      matchedNonEmptySignal: false,
      reason: "strong identity attributes match exactly",
    };
  }

  const capturedRole = normalizeComparedText(captured.role, INSPECTION_ROLE_LIMIT);
  const capturedName = normalizeComparedText(
    captured.accessibleName,
    INSPECTION_ACCESSIBLE_NAME_LIMIT
  );
  const capturedText = normalizeComparedText(captured.text, INSPECTION_TEXT_LIMIT);
  const liveRole = normalizeComparedText(
    live.getAttribute("role") ?? "",
    INSPECTION_ROLE_LIMIT
  );
  const liveName = normalizeComparedText(
    extractAccessibleName(live),
    INSPECTION_ACCESSIBLE_NAME_LIMIT
  );
  const liveText = normalizeComparedText(
    live.textContent ?? "",
    INSPECTION_TEXT_LIMIT
  );

  let score = 0;
  let matchedNonEmptySignal = false;

  if (liveRole === capturedRole) {
    if (capturedRole) {
      score += 2;
      matchedNonEmptySignal = true;
    }
  } else {
    score -= 4;
  }

  if (liveName === capturedName) {
    if (capturedName) {
      score += 3;
      matchedNonEmptySignal = true;
    }
  } else {
    score -= 3;
  }

  if (liveText === capturedText) {
    if (capturedText) {
      score += 3;
      matchedNonEmptySignal = true;
    }
  } else {
    score -= 2;
  }

  const parent = composedParent(live);
  const parentTagName = parent ? parent.tagName.toLowerCase() : "";
  const parentRole = parent
    ? normalizeComparedText(parent.getAttribute("role") ?? "", INSPECTION_ROLE_LIMIT)
    : "";
  const parentExact =
    parentTagName === captured.parent.tagName &&
    parentRole === normalizeComparedText(captured.parent.role, INSPECTION_ROLE_LIMIT);
  score += parentExact ? 1 : -1;

  const childDiff = Math.abs(live.children.length - captured.childCount);
  if (childDiff === 0) score += 1;
  else if (childDiff === 1) score += 0;
  else score -= 1;

  if (!capturedRole && !capturedName && !capturedText) {
    if (parentExact && childDiff === 0) {
      return {
        accepted: true,
        score,
        matchedNonEmptySignal: false,
        reason: "no semantic signals captured; parent tag/role and child count match exactly",
      };
    }
    return {
      accepted: false,
      score,
      matchedNonEmptySignal: false,
      reason: "no semantic signals captured; parent/child structural match failed",
    };
  }

  if (score >= 4 && matchedNonEmptySignal) {
    return {
      accepted: true,
      score,
      matchedNonEmptySignal,
      reason: `score ${score} meets threshold with a matched non-empty signal`,
    };
  }
  return {
    accepted: false,
    score,
    matchedNonEmptySignal,
    reason: `score ${score} below threshold or no matched signal`,
  };
}
