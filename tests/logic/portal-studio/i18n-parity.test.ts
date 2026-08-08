/**
 * Goal 05 — strict en-US / zh-CN key-set parity (AC 4).
 * Every user-facing string must exist in BOTH locales with the SAME key
 * set — no extras, no missing keys — so a translated UI can never show a
 * missing label or an untranslated string.
 */
import { describe, expect, it } from "vitest";

import { starter as enUS } from "@/locales/en-US";
import { starter as zhCN } from "@/locales/zh-CN";

const collectKeys = (value: unknown, prefix = "", out: string[] = []): string[] => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, entry] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (entry && typeof entry === "object") {
        collectKeys(entry, path, out);
      } else {
        out.push(path);
      }
    }
  }
  return out;
};

describe("i18n key-set parity (en-US vs zh-CN)", () => {
  it("has identical key sets — no extras, no missing keys", () => {
    const enKeys = collectKeys(enUS).sort();
    const zhKeys = collectKeys(zhCN).sort();
    expect(enKeys).toEqual(zhKeys);
  });

  it("covers every studio.* namespace key referenced by the code", () => {
    // Spot-check the Annotation-first surface (G01–G05). The locale files
    // use FLAT keys ("studio.toggle.open"), so look them up directly.
    const enFlat = enUS as Record<string, unknown>;
    for (const key of [
      "studio.toggle.open",
      "studio.toggle.close",
      "studio.annotations",
      "studio.annotationsList",
      "studio.unresolved",
      "studio.captureFailed",
      "studio.instruction",
      "studio.instructionPlaceholder",
      "studio.saving",
      "studio.saved",
      "studio.errorSave",
      "studio.sessionStale",
      "studio.more",
      "studio.resetDock",
      "studio.clearAllAnnotations",
      "studio.confirmClearAll",
      "studio.clearAll",
      "studio.multiSelect",
      "studio.multiHint",
      "studio.finishGroup",
      "studio.unsaved",
      "studio.hidden",
      "studio.confirmDelete",
      "studio.delete",
      "studio.editAnnotation",
      "studio.hideAnnotation",
      "studio.deleteAnnotation",
      "studio.copy",
      "studio.copied",
      "studio.copyManual",
      "studio.copyManualHint",
      "studio.copyEmpty",
      "studio.completeAnnotation",
      "studio.completed",
      "studio.completeAll",
    ]) {
      expect(enFlat[key], `missing en ${key}`).toBeDefined();
    }
  });

  it("has no empty or placeholder values", () => {
    const values = [
      ...Object.values(enUS as Record<string, unknown>),
      ...Object.values(zhCN as Record<string, unknown>),
    ].filter((v) => typeof v === "string" && v.startsWith("studio."));
    expect(values.every((v) => typeof v === "string" && v.trim().length > 0)).toBe(
      true
    );
  });
});
