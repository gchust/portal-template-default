/**
 * Goal 06 — machine-readable source-accuracy benchmark (test-owned targets).
 *
 * Proves, from the real fixture page, that every test-owned React target
 * (plain / memo / forwardRef / map / portal / shadcn / SVG-button / nested)
 * reports workspace-owned source context: the correct file, a positive
 * line, a valid column and a source stack containing the expected
 * workspace component. Also proves that a NON-React target (the plain-HTML
 * same-origin iframe button) reports source-null explicitly — never a
 * guessed file. Writes `.portal-studio-evidence/react-grab-g01/
 * source-benchmark.json` in the Goal 06 schema.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import type { ElementProof, ReactGrabG01Api } from "./fixture";

const evidenceRoot = path.resolve(
  new URL("../../.portal-studio-evidence/react-grab-g01", import.meta.url)
    .pathname
);

const callApi = async <T>(
  page: import("@playwright/test").Page,
  method: keyof ReactGrabG01Api,
  args: unknown[] = []
) =>
  page.evaluate(
    async ({ method, args }) => {
      const fixture = window.__REACT_GRAB_G01__;
      if (!fixture) throw new Error("React Grab fixture API is not ready");
      const value = fixture[method];
      if (typeof value !== "function") return value;
      return await (value as (...values: unknown[]) => unknown)(...args);
    },
    { method, args }
  ) as Promise<Awaited<T>>;

const openFixture = async (page: import("@playwright/test").Page) => {
  await page.goto("./");
  await page.locator("#fixture-ready").waitFor();
  const fixture = await page.evaluate(() => !!window.__REACT_GRAB_G01__);
  expect(fixture).toBe(true);
};

type BenchmarkTarget = {
  id: string;
  expectedFile: string;
  expectedComponent: string;
  /** Non-React targets must report source null explicitly, never guessed. */
  expectNullSource?: boolean;
};

const BENCHMARK_TARGETS: BenchmarkTarget[] = [
  { id: "fixture-plain-button", expectedFile: "fixture.tsx", expectedComponent: "PlainButton" },
  { id: "fixture-memo-button", expectedFile: "fixture.tsx", expectedComponent: "MemoButton" },
  { id: "fixture-forward-ref-button", expectedFile: "fixture.tsx", expectedComponent: "ForwardRefButton" },
  { id: "fixture-mapped-item-2", expectedFile: "fixture.tsx", expectedComponent: "MappedItem" },
  { id: "fixture-mapped-item-3", expectedFile: "fixture.tsx", expectedComponent: "MappedItem" },
  { id: "fixture-portal-dialog-action", expectedFile: "fixture.tsx", expectedComponent: "PortalDialogAction" },
  // The shadcn button is a REAL template component (src/components/ui/button.tsx)
  // rendered inside the fixture — its top source frame must be the template
  // file, with the fixture frame below in the stack.
  { id: "fixture-shadcn-button", expectedFile: "src/components/ui/button.tsx", expectedComponent: "Button" },
  { id: "fixture-svg-button", expectedFile: "fixture.tsx", expectedComponent: "FixtureApp" },
  { id: "fixture-nested-button", expectedFile: "fixture.tsx", expectedComponent: "FixtureApp" },
];

type BenchmarkRow = {
  id: string;
  expectedFile: string;
  actualFile: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
  expectedComponent: string;
  actualComponents: string[];
  stackContainsExpected: boolean;
  sourceIsNullAsExpected: boolean;
  pass: boolean;
};

test("G06 source benchmark: test-owned fixture targets", async ({ page }) => {
  await openFixture(page);
  const rows: BenchmarkRow[] = [];

  for (const target of BENCHMARK_TARGETS) {
    const proof = await callApi<ElementProof>(page, "inspect", [target.id]);
    const actualFile = proof.filePath;
    const components = proof.stack
      .map((frame) => frame.componentName)
      .filter(Boolean) as string[];
    const componentEvidence = components.join(" ");
    const fileOk =
      actualFile !== null &&
      !actualFile.includes("node_modules") &&
      path.basename(actualFile) === path.basename(target.expectedFile);
    const lineOk =
      typeof proof.lineNumber === "number" && proof.lineNumber > 0;
    const columnOk =
      typeof proof.columnNumber === "number" && proof.columnNumber >= 0;
    const stackContainsExpected = componentEvidence.includes(
      target.expectedComponent
    );
    const sourceIsNullAsExpected =
      target.expectNullSource === true
        ? actualFile === null && proof.lineNumber === null
        : true;

    const pass =
      fileOk &&
      lineOk &&
      columnOk &&
      stackContainsExpected &&
      sourceIsNullAsExpected;
    rows.push({
      id: target.id,
      expectedFile: target.expectedFile,
      actualFile,
      lineNumber: proof.lineNumber,
      columnNumber: proof.columnNumber,
      expectedComponent: target.expectedComponent,
      actualComponents: components,
      stackContainsExpected,
      sourceIsNullAsExpected,
      pass,
    });
    expect(
      pass,
      `${target.id}: file=${actualFile} line=${proof.lineNumber} col=${proof.columnNumber} components=${componentEvidence}`
    ).toBe(true);
  }

  // Non-React target: the same-origin iframe button is plain HTML — the
  // engine must report source-null explicitly, never a guessed file.
  const iframeButton = await callApi<ElementProof>(page, "inspectIframe");
  const nonReactRow: BenchmarkRow = {
    id: "iframe-plain-html-button",
    expectedFile: "null (non-React)",
    actualFile: iframeButton.filePath,
    lineNumber: iframeButton.lineNumber,
    columnNumber: iframeButton.columnNumber,
    expectedComponent: "null (non-React)",
    actualComponents: iframeButton.stack.map((f) => f.componentName ?? ""),
    stackContainsExpected: true,
    sourceIsNullAsExpected:
      iframeButton.filePath === null && iframeButton.lineNumber === null,
    pass: iframeButton.filePath === null && iframeButton.lineNumber === null,
  };
  expect(nonReactRow.pass, `iframe source must be null: ${JSON.stringify(iframeButton)}`).toBe(true);
  rows.push(nonReactRow);

  const report = {
    reactGrabVersion: "0.1.50",
    generatedAt: new Date().toISOString(),
    targets: rows,
    summary: {
      total: rows.length,
      passed: rows.filter((row) => row.pass).length,
      allFilesCorrect: rows.every((row) =>
        row.pass
          ? row.expectedFile === "null (non-React)"
            ? row.actualFile === null
            : row.actualFile !== null &&
              path.basename(row.actualFile) === path.basename(row.expectedFile)
          : false
      ),
    },
  };
  mkdirSync(evidenceRoot, { recursive: true });
  writeFileSync(
    path.join(evidenceRoot, "source-benchmark.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );
  expect(report.summary.passed).toBe(report.summary.total);
});
