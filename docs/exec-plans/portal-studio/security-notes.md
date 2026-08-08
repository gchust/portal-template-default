# Portal Studio — security notes

Dev-only agent feedback tooling. Security invariants (shared contract §2/§3)
and how they are enforced:

## Dev-only, enforced at build level

- All Studio code, the toolbar, diagnostics capture, heartbeat, screenshot
  command, and the MCP client live behind a `serve`-only Vite plugin. Nothing
  imports them in the production module graph; `pnpm build` output contains no
  Studio markers (chunk names and content, verified by grep) and exposes no
  endpoints (prod preview POST probes return 404).
- Hiding behind a button is never acceptable; exclusion is structural.

## Endpoint hardening

- Dev-machine only (D-031): loopback (`127.0.0.1`/`::1`/`::ffff:127.0.0.1`)
  plus any address bound to the dev machine itself (LAN/container IPs — the
  same operator reaching the dev portal through its own LAN origin, which
  previously 404'd). Any other remote address is rejected with 404 unless
  the plugin opts in with `allowRemote` (still token-protected).
  Same-origin; no CORS headers.
- Random per-session token (≥ 32 bytes CSPRNG) protects every endpoint;
  comparison is hash-then-`timingSafeEqual` (constant-time, no length leak).
  Missing/wrong tokens are indistinguishable from a missing endpoint (404).
  Brute force cannot gain access (tested); no rate limiter is added — the
  loopback + 256-bit token model makes one unnecessary, and a 429 could
  interrupt agent loops (D-022).
- Path-traversal protection on every file operation (absolute, `..`, encoded
  variants rejected by tests). Atomic writes (temp + rename, mode 0600).
- Bounded buffers and per-route body caps (task 256 KB, heartbeat 1 KB,
  command 16 KB, PNG 2 MB decoded / 2.8 MB wire, diagnostics 64 KB, final
  artifact 256 KB re-checked after merges).

## Secrets handling

- Structured captures (task JSON, diagnostics, attributes, URLs) are redacted
  at ingestion (client) and re-sanitized server-side (authoritative manifest).
  Request/response bodies are never captured (types carry no body fields; the
  server shape whitelist drops unknown keys; tests assert absence).
- The session token never enters artifacts; it is additionally stripped from
  the serialized artifact before writing.
- **Screenshots are pixel snapshots of the viewport**: content visible on
  screen (including text) is rendered into the PNG, as with any screenshot.
  Secret-bearing DOM *attributes* are stripped before serialization, but
  visible text is not occluded (D-023). Treat screenshots as local dev
  artifacts.
- MCP credentials never live in frontend code; the MCP server reads the token
  in-process only (env or `session.json`).

## Verification honesty

- Revision waits never silently pass: the reload bump is the authoritative
  signal; an HMR ack counts only with a live heartbeat; otherwise the task is
  marked `stale` with a bounded deadline (`expectedAfter`).

## Scope note

Abuse-suite results and per-goal evidence live in
`docs/exec-plans/portal-studio/` (ExecPlans 01–05 logs, `abuse.test.ts`,
contract Decision Log D-014…D-024).
