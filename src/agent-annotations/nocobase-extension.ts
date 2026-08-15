import { defineClientExtension } from "@gchust/agent-annotations/extension";
import type { AgentAnnotationsJsonObject } from "@gchust/agent-annotations/types";
import { getCurrentLocale, translate } from "@nocobase/portal-sdk/i18n";
import { portalI18nReady } from "@/providers/i18n/runtime";

await portalI18nReady;

export const NOCOBASE_EXTENSION_ID = "nocobase.portal";
const STRONG_ATTRIBUTES = [
  "data-ai-page-element",
  "data-nb-resource",
  "data-nb-field",
  "data-nb-action",
  "data-nb-surface",
] as const;
const SENSITIVE_CONTEXT_ATTRIBUTE = /^data-nb-(?:record(?:-id)?|value|default-value)$/;
const message = (key: string, en: string, zh: string) =>
  translate(
    `agentAnnotations.${key}`,
    { ns: "app" },
    getCurrentLocale().toLowerCase().startsWith("zh") ? zh : en
  );

const attributes = (element: Element) => {
  const strong: Record<string, string> = {};
  const contextual: Record<string, string> = {};
  let current: Element | null = element;
  for (let depth = 0; current && depth < 3; depth += 1, current = current.parentElement) {
    for (const attribute of Array.from(current.attributes)) {
      if (attribute.name !== "data-ai-page-element" && !attribute.name.startsWith("data-nb-")) continue;
      const target = (STRONG_ATTRIBUTES as readonly string[]).includes(attribute.name) ? strong : contextual;
      if (!(attribute.name in target)) target[attribute.name] = attribute.value.slice(0, 500);
    }
  }
  return { strong, contextual };
};

const redactNocoBaseContext = (value: AgentAnnotationsJsonObject): AgentAnnotationsJsonObject => {
  const clean = (input: AgentAnnotationsJsonObject): AgentAnnotationsJsonObject =>
    Object.fromEntries(
      Object.entries(input).flatMap(([key, entry]) =>
        SENSITIVE_CONTEXT_ATTRIBUTE.test(key)
          ? []
          : [[key, entry && typeof entry === "object" && !Array.isArray(entry) ? clean(entry as AgentAnnotationsJsonObject) : entry]]
      )
    );
  return clean(value);
};

export default defineClientExtension({
  id: NOCOBASE_EXTENSION_ID,
  apiVersion: 1,
  host: {
    locale: getCurrentLocale,
    routeKey: () => `${location.pathname}${location.search}${location.hash}`,
    identity: (element) => attributes(element).strong,
    messages: {
      Pick: message("pick", "Pick", "选取"),
      Multi: message("multi", "Multi", "多选"),
      Area: message("area", "Area", "区域"),
      Copy: message("copy", "Copy", "复制"),
      Markers: message("markers", "Markers", "标记"),
      Annotations: message("annotations", "Annotations", "批注"),
      "Shortcut help": message("shortcutHelp", "Shortcut help", "快捷键帮助"),
      "Collapse toolbar": message("collapse", "Collapse toolbar", "收起工具栏"),
    },
  },
  targetEnrichers: [{ id: "context", enrich: ({ element }) => attributes(element) }],
  redactors: [{ id: "nocobase", redact: redactNocoBaseContext }],
});

export { attributes as collectNocoBaseContext, redactNocoBaseContext };
