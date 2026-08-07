/**
 * Portal Studio — runtime diagnostics (client side, schema v3).
 *
 * Captures console.error, window errors, unhandled rejections, failed fetch
 * and failed XMLHttpRequest into a bounded ring buffer. Every entry is
 * redacted AT INGESTION (baseline `redactPortalErrorText` + extensions) with
 * per-entry and total byte caps; identical source+message pairs within the
 * dedup window are coalesced with an occurrence counter. Request/response
 * bodies are never captured (types carry no body fields; the server shape
 * whitelist makes them physically unwritable).
 *
 * Recursion safety: capture code never logs through the captured channels —
 * internal failures fall back to a guard flag and `console.warn` (which is
 * not a captured channel), so the buffer can never observe its own errors.
 */

import { redactTextValue } from "./redact";
import type { DiagnosticEntry, DiagnosticSource } from "./types";

export const MAX_DIAGNOSTIC_ENTRIES = 100;
export const DEDUP_WINDOW_MS = 10_000;
export const MAX_DIAGNOSTIC_MESSAGE = 2000;
export const MAX_DIAGNOSTIC_STACK = 4000;
export const MAX_DIAGNOSTIC_URL = 2000;
export const MAX_DIAGNOSTICS_BYTES = 64 * 1024;

export type DiagnosticsBuffer = {
  entries: DiagnosticEntry[];
};

export const createDiagnosticsBuffer = (): DiagnosticsBuffer => ({
  entries: [],
});

/**
 * Process-wide singleton buffer shared by the capture installation (mounted
 * once) and the toolbar save path, so HMR re-imports never create a second
 * buffer or a second capture chain.
 */
export const sharedDiagnosticsBuffer = createDiagnosticsBuffer();

const truncateWithMarker = (value: string, limit: number) =>
  value.length > limit ? `${value.slice(0, limit)}…[truncated]` : value;

const readString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const readErrorParts = (error: unknown): { message: string; stack?: string } => {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  if (typeof error === "string") return { message: error };
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
};

const parseUrl = (input: unknown): string | undefined => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return undefined;
};

/**
 * Record a redacted diagnostic entry. Dedup: same source+message within the
 * window (measured from the entry's first occurrence) coalesces into the
 * existing entry with an incremented counter; otherwise a new entry is
 * appended and the ring evicts the oldest beyond the cap.
 */
export function recordDiagnostic(
  buffer: DiagnosticsBuffer,
  source: DiagnosticSource,
  rawMessage: unknown,
  rawStack?: unknown,
  rawUrl?: unknown,
  now: number = Date.now()
): void {
  const parts = readErrorParts(rawMessage);
  const message = truncateWithMarker(
    redactTextValue(parts.message),
    MAX_DIAGNOSTIC_MESSAGE
  );
  if (!message.trim()) return;

  const stack = readString(rawStack)
    ? truncateWithMarker(
        redactTextValue(readString(rawStack) as string),
        MAX_DIAGNOSTIC_STACK
      )
    : parts.stack
      ? truncateWithMarker(
          redactTextValue(parts.stack),
          MAX_DIAGNOSTIC_STACK
        )
      : undefined;
  const url = parseUrl(rawUrl)
    ? truncateWithMarker(
        redactTextValue(parseUrl(rawUrl) as string),
        MAX_DIAGNOSTIC_URL
      )
    : undefined;

  const existing = buffer.entries.find(
    (entry) =>
      entry.source === source &&
      entry.message === message &&
      now - Date.parse(entry.timestamp) <= DEDUP_WINDOW_MS
  );
  if (existing) {
    existing.occurrenceCount += 1;
    return;
  }

  buffer.entries.push({
    source,
    message,
    ...(stack ? { stack } : {}),
    ...(url ? { url } : {}),
    timestamp: new Date(now).toISOString(),
    occurrenceCount: 1,
  });
  if (buffer.entries.length > MAX_DIAGNOSTIC_ENTRIES) {
    buffer.entries.shift();
  }
}

/**
 * UTF-8 byte length, accurate for astral code points (surrogate pairs /
 * emoji = 4 bytes). Primary path uses TextEncoder (present in every target
 * runtime: modern browsers and Node ≥ 18). The fallback is kept for exotic
 * runtimes and counts surrogate pairs correctly instead of over-counting
 * them as two 3-byte code units.
 */
export const utf8ByteLength = (value: string): number => {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).length;
  }
  let size = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) {
      size += 1;
    } else if (code < 0x800) {
      size += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        size += 4; // astral code point (surrogate pair)
        index += 1;
      } else {
        size += 3; // lone high surrogate
      }
    } else {
      size += 3;
    }
  }
  return size;
};

/** Serialized byte size of the current buffer (for total caps). */
export function diagnosticsBytes(buffer: DiagnosticsBuffer): number {
  return utf8ByteLength(JSON.stringify(buffer.entries));
}

/** Snapshot of the buffer entries (defensive copy). */
export function snapshotDiagnostics(
  buffer: DiagnosticsBuffer
): DiagnosticEntry[] {
  return buffer.entries.map((entry) => ({ ...entry }));
}

/**
 * Install the five capture channels on `window`/`document`. Returns a
 * disposer. Internal capture errors fall back to `console.warn` (never the
 * captured `console.error` channel) guarded by a flag.
 */
const CAPTURE_INSTALLED_FLAG = "__PORTAL_STUDIO_CAPTURE_INSTALLED__";

export function installDiagnosticsCapture(
  buffer: DiagnosticsBuffer
): () => void {
  if (
    typeof window !== "undefined" &&
    (window as unknown as Record<string, unknown>)[CAPTURE_INSTALLED_FLAG] === true
  ) {
    return () => undefined;
  }
  let capturing = false;
  const safeCapture = (
    source: DiagnosticSource,
    message: unknown,
    stack?: unknown,
    url?: unknown
  ) => {
    if (capturing) return;
    capturing = true;
    try {
      recordDiagnostic(buffer, source, message, stack, url);
    } catch {
      // Never propagate capture failures into the page.
    } finally {
      capturing = false;
    }
  };

  const originalConsoleError = console.error;
  const handleConsoleError = (...args: unknown[]) => {
    // The original channel is preserved for the page's own consumers; our
    // capture never routes through it (recursion guard).
    originalConsoleError.apply(console, args);
    safeCapture("console", args[0], args[1]);
  };

  const handleWindowError = (event: ErrorEvent) => {
    safeCapture(
      "window",
      event.message,
      event.error,
      `${event.filename}${event.lineno ? `:${event.lineno}` : ""}`
    );
  };

  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    safeCapture("promise", event.reason);
  };

  const originalFetch = window.fetch;
  const handleFetch: typeof window.fetch = (...args) => {
    const url = parseUrl(args[0]);
    return originalFetch.apply(window, args).then(
      (response) => {
        if (!response.ok) {
          safeCapture("fetch", `HTTP ${response.status}`, undefined, url);
        }
        return response;
      },
      (error: unknown) => {
        const parts = readErrorParts(error);
        safeCapture("fetch", parts.message, parts.stack, url);
        throw error;
      }
    );
  };

  const patchXhr = () => {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function patchedOpen(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      async = true,
      username?: string | null,
      password?: string | null
    ) {
      (this as XMLHttpRequest & { __psUrl?: string }).__psUrl = String(url);
      return originalOpen.call(
        this,
        method,
        url,
        Boolean(async),
        username ?? null,
        password ?? null
      );
    };
    XMLHttpRequest.prototype.send = function patchedSend(
      this: XMLHttpRequest,
      ...args: Parameters<typeof XMLHttpRequest.prototype.send>
    ) {
      const request = this as XMLHttpRequest & { __psUrl?: string };
      const handleDone = () => {
        request.removeEventListener("loadend", handleDone);
        request.removeEventListener("error", handleDone);
        request.removeEventListener("abort", handleDone);
        if (request.status >= 400) {
          safeCapture("xhr", `HTTP ${request.status}`, undefined, request.__psUrl);
        }
      };
      const handleFailure = () => {
        request.removeEventListener("loadend", handleDone);
        request.removeEventListener("error", handleFailure);
        request.removeEventListener("abort", handleFailure);
        safeCapture("xhr", "XHR request failed", undefined, request.__psUrl);
      };
      request.addEventListener("loadend", handleDone);
      request.addEventListener("error", handleFailure);
      request.addEventListener("abort", handleFailure);
      return originalSend.apply(request, args);
    };
  };

  console.error = handleConsoleError as typeof console.error;
  window.addEventListener("error", handleWindowError);
  window.addEventListener("unhandledrejection", handleUnhandledRejection);
  window.fetch = handleFetch;
  patchXhr();

  (window as unknown as Record<string, unknown>)[CAPTURE_INSTALLED_FLAG] = true;
  return () => {
    (window as unknown as Record<string, unknown>)[CAPTURE_INSTALLED_FLAG] = false;
    console.error = originalConsoleError;
    window.removeEventListener("error", handleWindowError);
    window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    window.fetch = originalFetch;
  };
}
