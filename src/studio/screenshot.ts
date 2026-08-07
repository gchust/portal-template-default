/**
 * Portal Studio — annotated viewport screenshot (client side, zero deps).
 *
 * Captures the current viewport by cloning the document into an SVG
 * `foreignObject` (with curated computed styles inlined and secret-bearing
 * attributes stripped), rasterizing it through a canvas, and stroking the
 * selection markers on top. The PNG data URL is sent to the dev-only
 * screenshot endpoint, which validates and stores it atomically.
 *
 * Trade-offs (documented in Decision Log D-010): webfonts and media
 * (img/video/canvas/iframe) are not rasterized (media is stripped to avoid
 * canvas tainting); this is an initial annotated screenshot, not a pixel-
 * perfect capture.
 */

export const MAX_SCREENSHOT_WIDTH = 1600;
export const MAX_SCREENSHOT_HEIGHT = 1200;

const SECRET_ATTRIBUTE_PATTERN =
  /(?:^|[-_.])(?:token|secret|password|authorization|cookie|api[-_.]?key)(?:$|[-_.]|$)/i;

const MEDIA_SELECTOR = "img, video, canvas, iframe, audio, source, object, embed";

/** Properties inlined from computed styles so the SVG renders faithfully. */
export const SCREENSHOT_STYLE_PROPERTIES = [
  "display",
  "position",
  "visibility",
  "opacity",
  "boxSizing",
  "width",
  "height",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "overflow",
  "color",
  "backgroundColor",
  "backgroundImage",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "lineHeight",
  "textAlign",
  "whiteSpace",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderTopStyle",
  "borderTopColor",
  "borderRadius",
  "flexDirection",
  "gap",
  "textDecorationLine",
  "verticalAlign",
] as const;

export type ScreenshotAnnotation = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CapturedScreenshot = {
  dataUrl: string;
  width: number;
  height: number;
};

/** Scale factor that fits the viewport into the bounded canvas. */
export function computeScreenshotScale(
  viewportWidth: number,
  viewportHeight: number,
  maxWidth: number = MAX_SCREENSHOT_WIDTH,
  maxHeight: number = MAX_SCREENSHOT_HEIGHT
): number {
  if (viewportWidth < 1 || viewportHeight < 1) return 1;
  return Math.min(1, maxWidth / viewportWidth, maxHeight / viewportHeight);
}

/** Remove attributes whose names look like secrets (clone-only mutation). */
export function stripSecretAttributes(element: Element): void {
  for (const attribute of Array.from(element.attributes)) {
    if (SECRET_ATTRIBUTE_PATTERN.test(attribute.name)) {
      element.removeAttribute(attribute.name);
    }
  }
}

/** Inline curated computed styles from a source element onto its clone. */
export function inlineComputedStyles(
  clone: Element,
  source: Element,
  properties: readonly string[] = SCREENSHOT_STYLE_PROPERTIES
): void {
  if (!(source instanceof HTMLElement)) return;
  const computed = getComputedStyle(source);
  const css: string[] = [];
  for (const property of properties) {
    const value = computed.getPropertyValue(property).trim();
    if (value) css.push(`${property}:${value}`);
  }
  if (css.length) clone.setAttribute("style", css.join(";"));
}

/** Wrap serialized XHTML into a standalone SVG document for canvas raster. */
export function buildScreenshotSvg(
  bodyXml: string,
  width: number,
  height: number
): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" `,
    `viewBox="0 0 ${width} ${height}">`,
    `<foreignObject width="100%" height="100%">${bodyXml}</foreignObject>`,
    `</svg>`,
  ].join("");
}

/** Clamp annotations into the canvas coordinate space (scaled). */
export function scaleAnnotations(
  annotations: ScreenshotAnnotation[],
  scale: number,
  canvasWidth: number,
  canvasHeight: number
): ScreenshotAnnotation[] {
  const clamp = (value: number, max: number) =>
    Math.max(0, Math.min(Math.round(value), max));
  return annotations.map((annotation) => ({
    x: clamp(annotation.x * scale, canvasWidth),
    y: clamp(annotation.y * scale, canvasHeight),
    width: clamp(annotation.width * scale, canvasWidth),
    height: clamp(annotation.height * scale, canvasHeight),
  }));
}

const serializeXml = (node: Node): string => {
  if (typeof XMLSerializer !== "undefined") {
    return new XMLSerializer().serializeToString(node);
  }
  return String(node);
};

/**
 * Capture the current viewport as a PNG data URL with selection markers.
 * Fails closed (returns null) on any error.
 */
export async function captureViewportPng(
  annotations: ScreenshotAnnotation[] = []
): Promise<CapturedScreenshot | null> {
  try {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return null;
    }
    const viewportWidth = Math.max(1, window.innerWidth);
    const viewportHeight = Math.max(1, window.innerHeight);
    const scale = computeScreenshotScale(viewportWidth, viewportHeight);
    const canvasWidth = Math.round(viewportWidth * scale);
    const canvasHeight = Math.round(viewportHeight * scale);

    const root = document.documentElement;
    const clone = root.cloneNode(true) as Element;

    // Media elements are stripped: external images would taint the canvas
    // and cannot be rasterized from a data-URL SVG.
    clone.querySelectorAll(MEDIA_SELECTOR).forEach((element) => {
      element.remove();
    });

    // Strip secret-bearing attributes before any serialization.
    const allClones = [clone, ...clone.querySelectorAll("*")];
    const allSources = [root, ...root.querySelectorAll("*")];
    for (const element of allClones) stripSecretAttributes(element);
    for (let index = 0; index < allClones.length; index += 1) {
      const source = allSources[index];
      if (source) inlineComputedStyles(allClones[index], source);
    }
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");

    const svg = buildScreenshotSvg(serializeXml(clone), canvasWidth, canvasHeight);
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("svg raster failed"));
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
    await loaded;

    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, canvasWidth, canvasHeight);

    const markers = scaleAnnotations(annotations, scale, canvasWidth, canvasHeight);
    context.strokeStyle = "#6366f1";
    context.lineWidth = Math.max(1, Math.round(scale * 2));
    for (const marker of markers) {
      context.fillStyle = "rgba(99, 102, 241, 0.12)";
      context.fillRect(marker.x, marker.y, marker.width, marker.height);
      context.strokeRect(marker.x, marker.y, marker.width, marker.height);
    }

    return {
      dataUrl: canvas.toDataURL("image/png"),
      width: canvasWidth,
      height: canvasHeight,
    };
  } catch {
    return null;
  }
}
