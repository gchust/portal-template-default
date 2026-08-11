/**
 * Portal Studio — bounded async v6 capture pipeline (Goal 03).
 *
 * live Element(s) -> sole InspectionEngine.inspect (concurrency EXACTLY 4,
 * input order preserved, all-or-nothing) -> NocoBase enrichment ->
 * redacted/bounded v6 ElementCapture[] + deduplicated businessContext.
 *
 * Guarantees:
 * - inspection concurrency is exactly 4 (never more, never less);
 * - results are returned in input order regardless of completion order;
 * - a single failed inspection fails the WHOLE pipeline (no partial Multi
 *   save) with a typed InspectionError; the caller keeps the live
 *   selection/comment and can retry;
 * - cancellation: when `isCancelled` flips before the pipeline resolves,
 *   the result is discarded so a canceled capture can never write a stale
 *   draft.
 */

import { enrichInspectedElement } from "./nocobase-context";
import { inspectionEngine } from "./react-grab-engine";
import { InspectionError } from "./types";
import type {
  ElementCapture,
  EnrichedTarget,
  RouteContext,
} from "./types";
import type { BusinessContextItem } from "../types";

export const INSPECTION_CONCURRENCY = 4 as const;

export type CapturePipelineResult =
  | {
      ok: true;
      captures: ElementCapture[];
      businessContext: BusinessContextItem[];
    }
  | { ok: false; error: InspectionError };

export type CapturePipelineOptions = {
  /** Cancellation probe; the result is discarded when it flips mid-flight. */
  isCancelled?: () => boolean;
};

const MAX_BUSINESS_CONTEXT_ITEMS = 20;

const runWithConcurrency = async <T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> => {
  let nextIndex = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
};

/**
 * Inspect a live selection through the sole engine and build the v6
 * captures plus deduplicated business hints. All-or-nothing: a partial
 * failure returns `ok: false` and the caller retains the live selection
 * for retry. Order is preserved; concurrency is exactly 4.
 */
export async function buildCaptureDraft(
  elements: Element[],
  route: RouteContext,
  options: CapturePipelineOptions = {}
): Promise<CapturePipelineResult> {
  if (elements.length === 0) {
    return { ok: true, captures: [], businessContext: [] };
  }
  const slots = new Map<Element, number>(
    elements.map((element, index) => [element, index])
  );
  const enriched: Array<EnrichedTarget | null> = new Array(elements.length).fill(null);
  let failure: InspectionError | null = null;

  await runWithConcurrency(elements, INSPECTION_CONCURRENCY, async (element) => {
    if (failure || options.isCancelled?.()) return;
    const index = slots.get(element);
    if (index === undefined) return;
    try {
      const inspected = await inspectionEngine.inspect(element);
      enriched[index] = enrichInspectedElement(element, inspected, route);
    } catch (cause) {
      if (cause instanceof InspectionError) {
        failure = cause;
      } else {
        failure = new InspectionError(
          "upstream_error",
          "inspection pipeline failed",
          cause
        );
      }
    }
  });

  if (options.isCancelled?.()) {
    return {
      ok: false,
      error: new InspectionError(
        "upstream_error",
        "capture was cancelled before inspection finished"
      ),
    };
  }
  if (failure) return { ok: false, error: failure };

  const ordered = enriched.filter(
    (target): target is EnrichedTarget => target !== null
  );
  const seen = new Set<string>();
  const businessContext: BusinessContextItem[] = [];
  for (const target of ordered) {
    for (const item of target.businessContext) {
      const key = `${item.type}:${item.id ?? ""}:${item.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      businessContext.push(item);
      if (businessContext.length >= MAX_BUSINESS_CONTEXT_ITEMS) break;
    }
    if (businessContext.length >= MAX_BUSINESS_CONTEXT_ITEMS) break;
  }
  const captures: ElementCapture[] = ordered.map((target) => {
    const { businessContext: _business, route: _route, ...capture } = target;
    return capture as ElementCapture;
  });
  return { ok: true, captures, businessContext };
}
