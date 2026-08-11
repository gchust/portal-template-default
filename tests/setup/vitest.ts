import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// Goal 03: install the jsdom hit-test shim so the REAL react-grab
// primitives can hit-test in every Vitest environment (see
// hit-test-shim.ts for the documented jsdom limitation).
import { installHitTestShim } from "./hit-test-shim";

installHitTestShim();
