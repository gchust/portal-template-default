## Portal Studio React Grab migration

For work under `src/studio`, first read `docs/exec-plans/portal-studio-react-grab-migration-v1/00-shared-contract.md` and only the currently assigned numbered Goal. Keep that Goal's `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current. Complete and independently verify one Goal before starting the next.

The final architecture has exactly one generic perception engine: `react-grab/primitives`. Do not add a legacy/custom fallback, do not directly depend on `element-source`, do not import React Grab's default UI, and do not preserve task schema v1-v5 compatibility. Preserve NocoBase-specific annotation, task, business-context, security, diagnostics, CLI, and Agent-completion behavior.
