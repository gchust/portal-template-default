import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Whole-repository import-ownership and forbidden-pattern gate (shared
 * contract §4, G02-AC01/AC12/AC14).
 *
 * Pattern strings are constructed dynamically so this gate file itself never
 * matches the greps it enforces.
 */

const repoRoot = path.resolve(process.cwd());

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const collectFiles = (directory: string): string[] => {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) {
        continue;
      }
      const full = path.join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) visit(full);
      else if (SOURCE_EXTENSIONS.has(path.extname(entry))) files.push(full);
    }
  };
  visit(directory);
  return files;
};

const read = (file: string): string => readFileSync(file, "utf8");

const PRIMITIVES_IMPORT_PATTERN = new RegExp(
  'from\\s+["\']' + "react-grab/" + 'primitives["\']'
);
const FULL_PACKAGE_IMPORT_PATTERN = new RegExp(
  '(?:from\\s+|import\\s*\\()["\']' + 'react-grab' + '["\']'
);
const PRIVATE_PATH_IMPORT_PATTERN = new RegExp(
  'from\\s+["\']react-grab\\/' + '(?:dist|src)\\/' + '["\']'
);
const ELEMENT_SOURCE_IMPORT_PATTERN = new RegExp(
  '(?:from\\s+|import\\s*\\()["\']' + 'element-' + 'source' + '["\']'
);
const FIBER_PATTERN = new RegExp('__react' + 'Fiber\\$');
const MODULE_GRAPH_PATTERN = new RegExp('module' + 'Graph');
const TRANSFORM_RESULT_PATTERN = new RegExp('transform' + 'Result');
const RESOLVE_SOURCES_PATTERN = new RegExp('resolve' + 'ComponentSources');
const ASSIGN_SOURCES_PATTERN = new RegExp('assign' + 'SourceCandidates');
const FORBIDDEN_INSPECTION_PATTERNS = [
  FIBER_PATTERN,
  MODULE_GRAPH_PATTERN,
  TRANSFORM_RESULT_PATTERN,
  RESOLVE_SOURCES_PATTERN,
  ASSIGN_SOURCES_PATTERN,
  /\b(fallback|legacy)\b/,
];

describe("whole-repository react-grab import ownership", () => {
  const files = [
    ...collectFiles(path.join(repoRoot, "src")),
    ...collectFiles(path.join(repoRoot, "tests")),
    ...collectFiles(path.join(repoRoot, "e2e")),
    ...collectFiles(path.join(repoRoot, "scripts")),
  ];

  it("allows exactly one file to import the upstream primitives module", () => {
    const importers = files.filter((file) =>
      PRIMITIVES_IMPORT_PATTERN.test(read(file))
    );
    expect(importers).toEqual([
      path.join(repoRoot, "src", "studio", "inspection", "react-grab-engine.ts"),
    ]);
  });

  it("forbids full-package, private-path and third-party source imports anywhere", () => {
    for (const file of files) {
      const content = read(file);
      expect(
        FULL_PACKAGE_IMPORT_PATTERN.test(content),
        `${file} imports the full react-grab package`
      ).toBe(false);
      expect(
        PRIVATE_PATH_IMPORT_PATTERN.test(content),
        `${file} imports a react-grab private path`
      ).toBe(false);
      expect(
        ELEMENT_SOURCE_IMPORT_PATTERN.test(content),
        `${file} imports a third-party source package`
      ).toBe(false);
    }
  });
});

describe("inspection domain forbidden patterns", () => {
  const inspectionRoot = path.join(
    repoRoot,
    "src",
    "studio",
    "inspection"
  );
  const files = collectFiles(inspectionRoot);

  it("contains no Fiber/module-graph/source-resolver logic", () => {
    for (const file of files) {
      const content = read(file);
      for (const pattern of FORBIDDEN_INSPECTION_PATTERNS) {
        expect(
          pattern.test(content),
          `${file} matches forbidden pattern ${pattern}`
        ).toBe(false);
      }
    }
  });

  it("implements exactly the required module structure", () => {
    const names = files
      .map((file) => path.basename(file))
      .filter((name) => name.endsWith(".ts"))
      .sort();
    expect(names).toEqual([
      "hierarchy.ts",
      "index.ts",
      "nocobase-context.ts",
      "normalize.ts",
      "pipeline.ts",
      "react-grab-engine.ts",
      "react-grab-selector-locator.ts",
      "region.ts",
      "types.ts",
    ]);
  });
});
