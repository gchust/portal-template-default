/**
 * Endpoint failure → user-actionable message. The dev server regenerates its
 * session token on restart, so an already-open Studio tab holds a stale
 * token and every endpoint answers 404 not_found — the cryptic raw error
 * left users stuck (D-031 follow-up). Kept out of toolbar.tsx so the
 * component file stays fast-refresh clean.
 */
export const sessionErrorMessage = (
  status: number,
  payloadError?: string
): string =>
  status === 404 || payloadError === "not_found"
    ? "Portal Studio endpoint rejected the request (404) — the dev server may have restarted (reload the page) or this origin is not trusted (dev machine only unless the plugin enables allowRemote)"
    : payloadError ?? String(status);
