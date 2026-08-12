/**
 * Goal 05 — the permanent `studio:inspection:audit` architecture guard.
 *
 * The audit scans ACTIVE source/test/E2E/script trees (docs are never
 * scanned) and fails on any forbidden legacy construct. These tests build
 * tiny fixture trees in a temp directory and prove both directions: a
 * clean tree passes, and each forbidden construct (plus a duplicated
 * primitives importer) fails with the right check id.
 *
 * NOTE: this file intentionally contains the forbidden pattern literals to
 * build the failing fixtures — it is allowlisted inside the audit script
 * (PATTERN_ALLOWLIST), exactly like the audit script itself.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  runInspectionAudit,
  SOLE_PRIMITIVES_IMPORTER,
  type AuditResult,
} from "../../../scripts/portal-studio-inspection-audit";

const tempRoots: string[] = [];

const makeTree = (files: Record<string, string>): string => {
  const root = mkdtempSync(path.join(tmpdir(), "ps-audit-"));
  tempRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const ENGINE_PATH = "src/studio/inspection/react-grab-engine.ts";
// Fixture content is built dynamically so THIS file never matches the
// import-ownership greps it exercises (same convention as the ownership
// gate test).
const PRIMITIVES_SPECIFIER = "react-grab" + "/primitives";
const CLEAN_ENGINE = `import { getElementAtPoint } from "${PRIMITIVES_SPECIFIER}";\nexport const engine = { getElementAtPoint };\n`;
const CLEAN_TASK = `export const TASK_SCHEMA_VERSION = 6 as const;\n`;

const cleanFiles = (): Record<string, string> => ({
  [ENGINE_PATH]: CLEAN_ENGINE,
  "src/studio/task-model.ts": CLEAN_TASK,
  "tests/logic/portal-studio/task-model.test.ts": `import { expect, it } from "vitest";\nit("x", () => expect(1).toBe(1));\n`,
  "scripts/portal-studio-print.mjs": `console.log("print");\n`,
});

describe("portal-studio-inspection-audit", () => {
  it("passes on a clean fixture tree", () => {
    const result: AuditResult = runInspectionAudit(makeTree(cleanFiles()));
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.importerFiles).toEqual([ENGINE_PATH]);
  });

  it("fails when NO file imports the primitives", () => {
    const files = cleanFiles();
    delete files[ENGINE_PATH];
    files["src/studio/inspection/react-grab-engine.ts"] =
      `export const engine = { getElementAtPoint: null };\n`;
    const result = runInspectionAudit(makeTree(files));
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.check === "sole-primitives-importer")).toBe(true);
  });

  it("fails when a SECOND active source file imports the primitives", () => {
    const files = cleanFiles();
    files["src/studio/elsewhere.ts"] =
      `import { freeze } from "${PRIMITIVES_SPECIFIER}";\n`;
    const result = runInspectionAudit(makeTree(files));
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.check === "sole-primitives-importer")).toBe(true);
  });

  const forbiddenFixtures: Array<{
    check: string;
    content: string;
  }> = [
    { check: "fiber", content: `const key = element.__reactFiber$abc;\n` },
    { check: "fiber", content: `findFiberKey(element);\n` },
    { check: "fiber", content: `collectComponentChain(element);\n` },
    { check: "fiber", content: `readFiberTypeName(fiber);\n` },
    { check: "vite-source-guessing", content: `resolveComponentSources(graph);\n` },
    { check: "vite-source-guessing", content: `assignSourceCandidates(task);\n` },
    { check: "vite-source-guessing", content: `const code = transformResult?.code;\n` },
    {
      check: "candidate-arrays",
      content: `const selectorCandidates: SelectorCandidate[] = [];\n`,
    },
    { check: "candidate-arrays", content: `componentCandidates.push(c);\n` },
    { check: "candidate-arrays", content: `sourceCandidates = [];\n` },
    { check: "old-schema", content: `const V = TASK_SCHEMA_VERSION_V1;\n` },
    { check: "old-schema", content: `const V = TASK_SCHEMA_VERSION_V2;\n` },
    { check: "old-schema", content: `const V = TASK_SCHEMA_VERSION_V4;\n` },
    { check: "old-schema", content: `const V = TASK_SCHEMA_VERSION_V5;\n` },
    { check: "old-schema", content: `normalizeV4ToV5(task);\n` },
    { check: "old-schema", content: `normalizeLegacyToV5(task);\n` },
    { check: "old-schema", content: `normalizeElementCaptureV5(capture);\n` },
    { check: "legacy-engine-branch", content: `resolver: "legacy",\n` },
    { check: "legacy-engine-branch", content: `class LegacyAdapter {}\n` },
    { check: "legacy-engine-branch", content: `const engine = fallbackEngine();\n` },
    { check: "react-grab-ui", content: `import "react-grab";\n` },
    { check: "react-grab-ui", content: `const m = await import("react-grab");\n` },
    { check: "react-grab-ui", content: `import { x } from "react-grab/dist/foo";\n` },
    { check: "element-source", content: `import { x } from "element-source";\n` },
  ];

  it.each(forbiddenFixtures)(
    "fails on a forbidden construct: $check ($content)",
    ({ check, content }) => {
      const files = cleanFiles();
      files["src/studio/offender.ts"] = content;
      const result = runInspectionAudit(makeTree(files));
      expect(result.ok).toBe(false);
      const problem = result.problems.find((p) => p.check === check);
      expect(problem, `expected a problem for ${check}`).toBeDefined();
      expect(problem?.file).toBe("src/studio/offender.ts");
    }
  );

  it("fails on an element-source entry in package.json", () => {
    const files = cleanFiles();
    files["package.json"] = JSON.stringify({
      dependencies: { "element-source": "1.0.0" },
    });
    const result = runInspectionAudit(makeTree(files));
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.check === "element-source")).toBe(true);
  });

  it("never scans docs (archived plans are documentation, not active code)", () => {
    const files = cleanFiles();
    files["docs/exec-plans/portal-studio/00-shared-contract.md"] =
      `# collectComponentChain and __reactFiber$ were the old engine\n`;
    const result = runInspectionAudit(makeTree(files));
    expect(result.ok).toBe(true);
  });

  it("exposes the sole importer contract constant", () => {
    expect(SOLE_PRIMITIVES_IMPORTER).toBe(
      "src/studio/inspection/react-grab-engine.ts"
    );
  });
});
