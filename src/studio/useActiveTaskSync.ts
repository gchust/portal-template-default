/**
 * Portal Studio — useActiveTaskSync (Goal 05 maintainability split).
 *
 * The active-task state + synchronization extracted from the toolbar
 * shell: the server artifact snapshot (taskRef), the annotations state,
 * the last-FETCHED taskRevision baseline, refreshTask (the one shared
 * fetch + normalize path), the mount/expand refetch, and the
 * visibility-aware revision poll that re-fetches ONLY when the
 * server-owned taskRevision changes (CLI-completed items then leave the
 * Open view / update All within two seconds). Completion is never
 * inferred from HMR, source revision, timestamps or tests — only from
 * the server revision.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { normalizeTask, describeUnsupportedSchema } from "./task-model.ts";
import type {
  Annotation,
  PortalStudioTask,
  UnsupportedSchemaResult,
} from "./types.ts";

export type ActiveTaskSyncConfig = {
  endpoint: string;
  token: string;
  revisionEndpoint?: string;
};

export function useActiveTaskSync(
  config: ActiveTaskSyncConfig,
  open: boolean
): {
  taskRef: React.MutableRefObject<PortalStudioTask | null>;
  annotations: Annotation[];
  setAnnotations: React.Dispatch<React.SetStateAction<Annotation[]>>;
  lastTaskRevisionRef: React.MutableRefObject<number | null>;
  /** Shared typed old-schema rejection (v1-v5 artifact on disk). */
  unsupported: UnsupportedSchemaResult | null;
  setUnsupported: React.Dispatch<
    React.SetStateAction<UnsupportedSchemaResult | null>
  >;
  refreshTask: () => Promise<void>;
} {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [unsupported, setUnsupported] = useState<UnsupportedSchemaResult | null>(null);
  const taskRef = useRef<PortalStudioTask | null>(null);
  const lastTaskRevisionRef = useRef<number | null>(null);

  // Load the persisted task (annotations + revision status; schema v4/v5
  // dual read, D-033 #17). Runs on mount (the dock badge shows the live
  // count without opening the panel), when the panel opens, and after a
  // save so Copy always reflects the SERVER artifact (screenshot +
  // heartbeat merged) — byte-identical to the print CLI (G04 parity).
  const refreshTask = useCallback((): Promise<void> => {
    if (typeof fetch !== "function") return Promise.resolve();
    return fetch(config.endpoint, {
      headers: { "X-Portal-Studio-Token": config.token },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          payload: {
            task?: PortalStudioTask | null;
            /** Typed old-schema rejection (schema v1-v5). */
            unsupported?: UnsupportedSchemaResult | null;
          } | null
        ) => {
          if (!payload?.task) {
            // The active task no longer exists (explicit clear or an
            // agent-side DELETE) — drop the stale local snapshot so the
            // NEXT save creates a FRESH taskId instead of resurrecting the
            // cleared task with its old annotations. An old-schema artifact
            // surfaces the shared unsupported_schema state instead.
            const unsupported =
              payload?.unsupported ?? describeUnsupportedSchema(payload?.task);
            taskRef.current = null;
            setAnnotations([]);
            lastTaskRevisionRef.current = null;
            if (unsupported) {
              setUnsupported(unsupported);
            } else {
              setUnsupported(null);
            }
            return;
          }
          const normalized = normalizeTask(payload.task);
          if (!normalized) {
            setUnsupported(describeUnsupportedSchema(payload.task));
            return;
          }
          setUnsupported(null);
          taskRef.current = normalized;
          setAnnotations(normalized.annotations);
          // Goal 05 (review P1): the revision baseline is ALWAYS the last
          // FETCHED task's taskRevision — never whatever the first poll
          // happened to read. This closes the race where a CLI completion
          // lands after mount but before the first poll: the first poll
          // then sees a revision DIFFERENT from this baseline and refetches.
          lastTaskRevisionRef.current = normalized.taskRevision ?? 0;
        }
      )
      .catch(() => {
        // Dev server restarting; status stays hidden.
      });
  }, [config.endpoint, config.token]);

  useEffect(() => {
    refreshTask();
    // Re-fetch when the dock expands/collapses (the launcher count and the
    // list need fresh data). The visibility-aware revision poll covers
    // server-side changes while open — no refetch needed when an auxiliary
    // panel opens, so optimistic local state is never discarded.
  }, [refreshTask, open]);

  // Goal 05: visibility-aware revision polling. While the document is
  // VISIBLE, poll the lightweight revision read about once per second and
  // re-fetch the task ONLY when the server-owned taskRevision changes
  // (CLI-completed items then leave the Open view / update All within two
  // seconds). Paused while the page is hidden; exponential backoff on
  // repeated failures.
  useEffect(() => {
    const revisionEndpoint = config.revisionEndpoint;
    if (!revisionEndpoint) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const schedule = (ms: number) => {
      if (cancelled) return;
      timer = setTimeout(() => void poll(), ms);
    };
    const poll = async () => {
      if (cancelled) return;
      // Paused while hidden; visibilitychange re-polls when visible.
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch(revisionEndpoint, {
          headers: { "X-Portal-Studio-Token": config.token },
        });
        if (!response.ok) throw new Error("revision read failed");
        const payload = (await response.json()) as {
          taskRevision?: number | null;
        };
        const revision =
          typeof payload.taskRevision === "number" ? payload.taskRevision : 0;
        const last = lastTaskRevisionRef.current;
        // Compare against the last FETCHED task's revision (set by
        // refreshTask). If we have never fetched (last === null) or the
        // revision moved, re-fetch — refreshTask re-baselines the ref.
        // Never accept the polled value as the baseline without fetching:
        // a CLI completion between mount and the first poll must sync.
        if (last === null || revision !== last) {
          refreshTask();
        }
        failures = 0;
        schedule(1000);
      } catch {
        // Dev server restarting or revision read failing: back off.
        failures += 1;
        schedule(Math.min(1000 * 2 ** failures, 15000));
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule(1000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshTask, config.endpoint, config.token, config.revisionEndpoint]);

  return {
    taskRef,
    annotations,
    setAnnotations,
    lastTaskRevisionRef,
    unsupported,
    setUnsupported,
    refreshTask,
  };
}
