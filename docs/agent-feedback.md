# Agent Feedback development integration

The Default Portal loads Agent Feedback only in the Vite development server.
`vite.config.ts` registers `@gchust/agent-feedback/vite` and supplies the
NocoBase browser extension at `src/agent-feedback/nocobase-extension.ts`.

The extension adds Portal locale labels, stable NocoBase identity attributes,
contextual `data-nb-*` evidence, and NocoBase-specific redaction. Persisted
tasks use `.agent-feedback/` and the `agent-feedback` CLI:

```bash
pnpm studio:list
pnpm studio:print -- --markdown
pnpm studio:complete -- <annotation-id> --verified --summary "Verified"
pnpm studio:reopen -- <annotation-id>
```

Production builds do not include the client runtime or development endpoints.
