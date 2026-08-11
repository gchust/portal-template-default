import { describe, expect, it } from "vitest";

import { reactGrabPrimitives } from "../../../e2e/react-grab-g01/primitives";

describe("react-grab public primitive contract", () => {
  it("exports the ten required callables without mounting the default UI", () => {
    expect(Object.keys(reactGrabPrimitives).sort()).toEqual(
      [
        "disposeBaselineStyles",
        "freeze",
        "getElementAtPoint",
        "getElementBounds",
        "getElementContext",
        "getElementSelector",
        "getElementsAtPoint",
        "isElementGrabbable",
        "isFreezeActive",
        "unfreeze",
      ].sort()
    );
    expect(Object.values(reactGrabPrimitives).every(
      (value) => typeof value === "function"
    )).toBe(true);
    expect(document.querySelector("[data-react-grab-toolbar]")).toBeNull();
    expect(document.querySelector("[data-react-grab-overlay-canvas]")).toBeNull();
  });
});
