import { describe, expect, it } from "vitest";

import extension, {
  collectNocoBaseContext,
  NOCOBASE_EXTENSION_ID,
  redactNocoBaseContext,
} from "@/agent-feedback/nocobase-extension";

describe("NocoBase Agent Feedback extension", () => {
  it("classifies stable identity and contextual evidence", () => {
    const parent = document.createElement("section");
    parent.setAttribute("data-nb-resource", "users");
    parent.setAttribute("data-nb-view", "table");
    const target = document.createElement("button");
    target.setAttribute("data-ai-page-element", "create-user");
    target.setAttribute("data-nb-action", "create");
    parent.append(target);

    expect(collectNocoBaseContext(target)).toEqual({
      strong: {
        "data-ai-page-element": "create-user",
        "data-nb-action": "create",
        "data-nb-resource": "users",
      },
      contextual: { "data-nb-view": "table" },
    });
    expect(extension.id).toBe(NOCOBASE_EXTENSION_ID);
    expect(extension.host?.identity?.(target)).toEqual(collectNocoBaseContext(target).strong);
  });

  it("uses one namespace and removes NocoBase secret-shaped context", async () => {
    const target = document.createElement("button");
    target.setAttribute("data-nb-resource", "users");
    expect(await extension.targetEnrichers?.[0]?.enrich({ element: target, inspection: {} as never }))
      .toEqual({ strong: { "data-nb-resource": "users" }, contextual: {} });
    expect(redactNocoBaseContext({
      strong: { "data-nb-resource": "users" },
      contextual: { "data-nb-record-id": "drop", "data-nb-view": "table" },
    })).toEqual({
      strong: { "data-nb-resource": "users" },
      contextual: { "data-nb-view": "table" },
    });
  });
});
