import {
  disposeBaselineStyles,
  freeze,
  getElementAtPoint,
  getElementBounds,
  getElementContext,
  getElementSelector,
  getElementsAtPoint,
  isElementGrabbable,
  isFreezeActive,
  unfreeze,
} from "react-grab/primitives";

export const reactGrabPrimitives = {
  getElementAtPoint,
  getElementsAtPoint,
  isElementGrabbable,
  getElementBounds,
  getElementSelector,
  getElementContext,
  freeze,
  unfreeze,
  isFreezeActive,
  disposeBaselineStyles,
} as const;
