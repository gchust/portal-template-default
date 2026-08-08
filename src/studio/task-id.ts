/**
 * Task id for the schema-v4 task JSON. `crypto.randomUUID` is only available
 * in secure contexts (https or localhost); the Studio also runs from plain
 * http on a LAN IP (D-031), where it throws and would strand the save flow
 * in the "saving" state. Fall back to a Math.random-based v4-shaped id.
 * Kept out of toolbar.tsx so the component file stays fast-refresh clean.
 */
export const newTaskId = (): string => {
  const cryptoApi = globalThis.crypto as
    | { randomUUID?: () => string }
    | undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  const hex8 = () => Math.random().toString(16).slice(2, 10).padEnd(8, "0");
  const hex4 = () => hex8().slice(0, 4);
  return `${hex8()}-${hex4()}-4${hex4().slice(0, 3)}-a${hex4().slice(0, 3)}-${hex8()}${hex4()}`;
};
