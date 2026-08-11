/**
 * Goal 03 — print CLI process tests (public package script, tsx runtime).
 *
 * Spawns `pnpm studio:print` against a real task artifact and asserts
 * exit/stdout/stderr. The v6 formatter output is golden-tested in
 * format-golden.test.ts; these tests prove the process boundary: v6
 * printing, the shared typed unsupported_schema result for old artifacts,
 * and option/error handling.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { v6TaskWithAnnotation } from "./fixtures/task-fixtures";

const runCli = (args: string[], fixture: unknown) => {
  const dir = mkdtempSync(path.join(tmpdir(), "portal-studio-print-"));
  try {
    mkdirSync(path.join(dir, "tasks"), { recursive: true });
    writeFileSync(
      path.join(dir, "tasks", "active-task.json"),
      JSON.stringify(fixture)
    );
    try {
      const stdout = execFileSync(
        "pnpm",
        ["--silent", "run", "studio:print", "--", ...args],
        {
          encoding: "utf8",
          env: { ...process.env, PORTAL_STUDIO_DIR: dir },
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
      return { status: 0, stdout, stderr: "" };
    } catch (error) {
      const e = error as {
        status?: number;
        stdout?: Buffer | string;
        stderr?: Buffer | string;
      };
      return {
        status: e.status ?? 1,
        stdout: String(e.stdout ?? ""),
        stderr: String(e.stderr ?? ""),
      };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("portal-studio-print CLI (v6)", () => {
  it("prints JSON via the shared formatter and exits 0", () => {
    const result = runCli(["--json"], v6TaskWithAnnotation());
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.schemaVersion).toBe(6);
    expect(parsed.annotations[0].elements[0].selector).toBe("#row-a");
  });

  it("prints markdown with v6 source location and business context", () => {
    const result = runCli(["--markdown"], v6TaskWithAnnotation());
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("# Task task-san-1");
    expect(result.stdout).toContain("- selector: #row-a");
    expect(result.stdout).toContain("- source: src/pages/users.tsx:12:4 (TableRow)");
    expect(result.stdout).toContain("- businessContext:");
    expect(result.stdout).not.toContain("Selector candidates");
  });

  it("renders old-schema artifacts as the typed unsupported_schema result", () => {
    for (const version of [1, 2, 3, 4, 5]) {
      const result = runCli(
        ["--markdown"],
        { schemaVersion: version, taskId: "old" }
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("# Unsupported task schema");
      expect(result.stdout).toContain(`- schemaVersion: ${version}`);
      expect(result.stdout).toContain("- expectedSchemaVersion: 6");
    }
  });

  it("exits 1 with a clear message when the task file is missing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "portal-studio-print-empty-"));
    try {
      mkdirSync(path.join(dir, "tasks"), { recursive: true });
      let status = 0;
      let stderr = "";
      try {
        execFileSync(
          "pnpm",
          ["--silent", "run", "studio:print", "--", "--json"],
          {
            encoding: "utf8",
            env: { ...process.env, PORTAL_STUDIO_DIR: dir },
            stdio: ["ignore", "pipe", "pipe"],
          }
        );
      } catch (error) {
        const e = error as { status?: number; stderr?: Buffer | string };
        status = e.status ?? 1;
        stderr = String(e.stderr ?? "");
      }
      expect(status).toBe(1);
      expect(stderr).toContain("no task found");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 2 for unknown arguments", () => {
    const result = runCli(["--bogus"], v6TaskWithAnnotation());
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Unknown argument");
  });
});
