/**
 * Goal 06 — browser mutation client transport.
 *
 * Sends typed MutationRequests to the dev-server mutate endpoint and
 * exposes the 409 conflict payload (current metadata/task) so the caller
 * can refresh, retry the still-valid operation once, then show explicit
 * conflict feedback. Browser list/editor and the agent CLI share the same
 * typed mutation semantics (mutation.ts).
 */

import type { MutationRequest } from "./mutation";
import type { PortalStudioTask } from "./types";

export type ConflictInfo = {
  taskRevision: number;
  task: PortalStudioTask;
};

export type MutationSendResult =
  | { ok: true; taskRevision: number; task: PortalStudioTask }
  | { ok: false; error: string; conflict?: ConflictInfo };

export async function postMutation(
  config: { token: string; mutateEndpoint: string },
  request: MutationRequest,
  options: { keepalive?: boolean } = {}
): Promise<MutationSendResult> {
  let response: Response;
  try {
    response = await fetch(config.mutateEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Portal-Studio-Token": config.token,
      },
      body: JSON.stringify(request),
      ...(options.keepalive ? { keepalive: true } : {}),
    });
  } catch {
    return { ok: false, error: "network error — dev server restarting" };
  }
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (response.status === 409) {
    return {
      ok: false,
      error: "revision_conflict",
      conflict: {
        taskRevision:
          typeof payload.taskRevision === "number" ? payload.taskRevision : 0,
        task: payload.task as PortalStudioTask,
      },
    };
  }
  if (response.ok && payload.ok === true) {
    return {
      ok: true,
      taskRevision:
        typeof payload.taskRevision === "number" ? payload.taskRevision : 0,
      task: payload.task as PortalStudioTask,
    };
  }
  return {
    ok: false,
    error: typeof payload.error === "string" ? payload.error : "mutation_failed",
  };
}
