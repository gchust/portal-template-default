# Agent Annotations development integration

The Default Portal loads Agent Annotations only in the Vite development server.
`vite.config.ts` registers `@gchust/agent-annotations/vite` and supplies the
NocoBase browser extension at `src/agent-annotations/nocobase-extension.ts`.

The extension adds Portal locale labels, stable NocoBase identity attributes,
contextual `data-nb-*` evidence, and NocoBase-specific redaction. Persisted
tasks use `.agent-annotations/` and the `agent-annotations` CLI:

```bash
pnpm annotations:list
pnpm annotations:print -- --markdown
pnpm annotations:complete -- <annotation-id> --verified --summary "Verified"
pnpm annotations:reopen -- <annotation-id>
```

Production builds do not include the client runtime or development endpoints.
