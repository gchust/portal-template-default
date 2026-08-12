#!/usr/bin/env tsx
/**
 * Portal Studio — permanent architecture audit (Goal 05).
 *
 * Public command: `pnpm studio:inspection:audit`
 *
 * A regression guard for the React Grab single-engine migration (shared
 * contract §4 / §7): the command exits non-zero unless the active source,
 * tests, E2E and scripts still satisfy every deletion invariant —
 *
 *   1. exactly ONE active application source file imports
 *      `react-grab/primitives` (src/studio/inspection/react-grab-engine.ts);
 *   2. no full `react-grab` UI import / dist / src path exists;
 *   3. no direct `element-source` dependency/import exists;
 *   4. no private React Fiber-key access exists;
 *   5. no Vite transformed-code/component-name source guessing exists;
 *   6. no candidate-array field/type exists;
 *   7. no v1-v5 schema constant/normalizer/migration exists;
 *   8. no runtime legacy/fallback engine branch exists.
 *
 * The command never hides active code: archived documentation lives under
 * docs/ (outside the scan scope) and the audit's OWN pattern strings live
 * in the allowlisted files below. The scanner is deliberately dumb — line
 * grep over the active scope — because the forbidden constructs are
 * literals that must never appear anywhere in active code.
 *
 * The audit is NOT a substitute for the independent semantic review; it
 * only pins the literal invariants.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export type AuditProblem = {
  check: string;
  file: string;
  line: number;
  match: string;
};

export type AuditResult = {
  ok: boolean;
  problems: AuditProblem[];
  importerFiles: string[];
};

/** The single allowed owner of `react-grab/primitives` (contract §4). */
export const SOLE_PRIMITIVES_IMPORTER = "src/studio/inspection/react-grab-engine.ts";

/** Active scan scope (docs are archived documentation, never scanned). */
const ACTIVE_SCOPE = ["src", "tests", "e2e", "scripts"];

/**
 * Explicit allowlist for files whose CONTENT legitimately contains the
 * forbidden pattern literals:
 * - this audit script itself (the check definitions);
 * - the audit's unit tests (they build intentionally failing fixtures);
 * - the archived superseded plans under docs/ are outside the scan scope.
 */
const PATTERN_ALLOWLIST = new Set([
  "scripts/portal-studio-inspection-audit.ts",
  "tests/logic/portal-studio/inspection-audit.test.ts",
]);

const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

type Check = {
  id: string;
  name: string;
  patterns: RegExp[];
};

const CHECKS: Check[] = [
  {
    id: "fiber",
    name: "private React Fiber-key access",
    patterns: [
      /__reactFiber\$|findFiberKey|collectComponentChain|readFiberTypeName/,
    ],
  },
  {
    id: "vite-source-guessing",
    name: "Vite transformed-code / component-name source guessing",
    patterns: [
      /resolveComponentSources|assignSourceCandidates|transformResult\?\.code|transformResult\.code/,
    ],
  },
  {
    id: "candidate-arrays",
    name: "selector/component/source candidate arrays",
    patterns: [
      /selectorCandidates|componentCandidates|sourceCandidates|SelectorCandidate|ComponentCandidate|SourceCandidate/,
    ],
  },
  {
    id: "old-schema",
    name: "v1-v5 schema constants / normalizers / migrations",
    patterns: [
      /TASK_SCHEMA_VERSION_V\d+|normalizeV4ToV5|normalizeLegacyToV5|normalizeElementCaptureV5/,
    ],
  },
  {
    id: "legacy-engine-branch",
    name: "runtime legacy/fallback engine branch",
    patterns: [/resolver:\s*["']legacy["']|Legacy.*Adapter|fallback.*engine|engine.*fallback/],
  },
  {
    id: "react-grab-ui",
    name: "full react-grab UI / private-path import",
    patterns: [
      /\bfrom\s*["']react-grab["']\s*;?/,
      /\bimport\s+["']react-grab["']\s*;?/,
      /import\s*\(\s*["']react-grab["']\s*\)/,
      /react-grab\/dist\//,
      /react-grab\/src\//,
    ],
  },
  {
    id: "element-source",
    name: "direct element-source dependency/import",
    patterns: [/element-source/],
  },
];

const walkFiles = (dir: string, base: string, out: string[]): void => {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (
      entry === "node_modules" ||
      entry === "dist" ||
      entry === "coverage" ||
      entry === ".git" ||
      entry === ".portal-studio"
    ) {
      continue;
    }
    const full = path.join(dir, entry);
    const rel = path.join(base, entry);
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      walkFiles(full, rel, out);
    } else if (SCANNED_EXTENSIONS.has(path.extname(entry))) {
      out.push(rel);
    }
  }
};

const readLines = (root: string, rel: string): string[] | null => {
  try {
    return readFileSync(path.join(root, rel), "utf8").split(/\r?\n/);
  } catch {
    return null;
  }
};

/**
 * Run the architecture audit over `root`. Fixture-friendly: pass any
 * directory tree shaped like the repository (src/tests/e2e/scripts).
 */
export function runInspectionAudit(root: string): AuditResult {
  const problems: AuditProblem[] = [];
  const importerFiles: string[] = [];
  const files: string[] = [];
  for (const scope of ACTIVE_SCOPE) {
    walkFiles(path.join(root, scope), scope, files);
  }
  // Dependency manifests are scanned for the direct element-source ban too.
  for (const manifest of ["package.json", "pnpm-lock.yaml"]) {
    if (existsSync(path.join(root, manifest))) files.push(manifest);
  }

  for (const rel of files.sort()) {
    if (PATTERN_ALLOWLIST.has(rel)) continue;
    const lines = readLines(root, rel);
    if (!lines) continue;
    if (rel.endsWith("package.json") || rel.endsWith("pnpm-lock.yaml")) {
      // Manifest scan: element-source only.
      const text = lines.join("\n");
      if (/element-source/.test(text)) {
        problems.push({
          check: "element-source",
          file: rel,
          line: 1,
          match: "element-source",
        });
      }
      continue;
    }
    const isPrimitivesImporter = lines.some((line) =>
      /react-grab\/primitives/.test(line)
    );
    if (isPrimitivesImporter) importerFiles.push(rel);
    for (const check of CHECKS) {
      for (let index = 0; index < lines.length; index += 1) {
        const match = check.patterns.find((pattern) => pattern.test(lines[index]));
        if (match) {
          problems.push({
            check: check.id,
            file: rel,
            line: index + 1,
            match: lines[index].trim().slice(0, 120),
          });
        }
      }
    }
  }

  // Check 1: exactly one active application source file imports the
  // primitives, and it is the sole owner.
  const srcImporters = importerFiles.filter((file) => file.startsWith("src/"));
  if (srcImporters.length !== 1 || srcImporters[0] !== SOLE_PRIMITIVES_IMPORTER) {
    problems.push({
      check: "sole-primitives-importer",
      file: SOLE_PRIMITIVES_IMPORTER,
      line: 1,
      match: `expected exactly one importer (${SOLE_PRIMITIVES_IMPORTER}); found: ${
        srcImporters.length === 0 ? "none" : srcImporters.join(", ")
      }`,
    });
  }

  return { ok: problems.length === 0, problems, importerFiles };
}

const main = (argv: string[]): number => {
  const root = argv[2] ?? process.cwd();
  const result = runInspectionAudit(root);
  if (result.ok) {
    console.log(
      `[portal-studio] inspection audit PASS — ${SOLE_PRIMITIVES_IMPORTER} is the sole primitives importer; no legacy engine/schema/candidate code.`
    );
    return 0;
  }
  console.error("[portal-studio] inspection audit FAIL:");
  for (const problem of result.problems) {
    console.error(
      `  - [${problem.check}] ${problem.file}:${problem.line} ${problem.match}`
    );
  }
  return 1;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv);
}
