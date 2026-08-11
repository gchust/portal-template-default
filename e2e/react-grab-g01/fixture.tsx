import {
  inspectionEngine,
  resolveUsefulTarget,
} from "@/studio/inspection";
import type {
  InspectedElement,
  PromotionReason,
  ViewportRect,
} from "@/studio/inspection";

import {
  forwardRef,
  memo,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";

import { Button } from "@/components/ui/button";

export type ElementProof = {
  id: string;
  tagName: string;
  selector: string;
  bounds: ViewportRect;
  componentName: string | null;
  filePath: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
  stack: Array<{
    filePath: string;
    lineNumber: number;
    columnNumber: number;
    componentName: string | null;
  }>;
};

export type HitProof = {
  point: { x: number; y: number };
  nativeTarget: { id: string; tagName: string; grabbable: boolean } | null;
  selectedTarget: { id: string; tagName: string } | null;
  engineTarget: { id: string; tagName: string } | null;
  selectedStack: Array<{ id: string; tagName: string }>;
  promoted: boolean;
  promotionReason: PromotionReason;
};

type BootstrapState = {
  clipboardWrites: number;
  clipboardStubbed: boolean;
  consoleErrors: string[];
};

export type ReactGrabG01Api = {
  engineSurface: Record<string, string>;
  inspect: (id: string) => Promise<ElementProof>;
  hit: (id: string, hideOverlay?: boolean) => HitProof;
  inspectShadow: () => Promise<ElementProof>;
  hitShadow: (hideOverlay?: boolean) => HitProof;
  inspectIframe: () => Promise<ElementProof>;
  hitIframe: (hideOverlay?: boolean) => HitProof;
  freezeCycle: () => {
    before: boolean;
    during: boolean;
    after: boolean;
    consoleErrors: string[];
  };
  uiState: () => {
    mountedUiAttributes: string[];
    clipboardWrites: number;
    clipboardStubbed: boolean;
    copyEventAllowed: boolean;
    hotkeyEventAllowed: boolean;
  };
};

declare global {
  interface Window {
    __REACT_GRAB_G01__?: ReactGrabG01Api;
    __REACT_GRAB_G01_BOOTSTRAP__?: BootstrapState;
  }
}

function PlainButton() {
  return <button id="fixture-plain-button">Plain React button</button>;
}

const MemoButton = memo(function MemoButton() {
  return <button id="fixture-memo-button">Memo React button</button>;
});

const ForwardRefButton = forwardRef<HTMLButtonElement>(
  function ForwardRefButton(_props, ref) {
    return (
      <button id="fixture-forward-ref-button" ref={ref}>
        Forward ref button
      </button>
    );
  }
);

function MappedItem({ index }: { index: number }) {
  return (
    <button id={`fixture-mapped-item-${index}`}>Mapped item {index}</button>
  );
}

function PortalDialogAction() {
  const target = document.getElementById("fixture-portal-root");
  if (!target) return null;
  return createPortal(
    <button id="fixture-portal-dialog-action">Portal dialog action</button>,
    target
  );
}

function OpenShadowFixture() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<ShadowRoot | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setRoot(host.shadowRoot ?? host.attachShadow({ mode: "open" }));
  }, []);

  return (
    <div id="fixture-shadow-host" ref={hostRef}>
      {root
        ? createPortal(
            <button id="fixture-shadow-button">Open shadow button</button>,
            root
          )
        : null}
    </div>
  );
}

const iframeDocument = `<!doctype html>
<html><head><style>
html,body{margin:0;width:100%;height:100%;font-family:system-ui}
body{display:flex;align-items:center;justify-content:center}
button{width:150px;height:44px}
</style></head><body>
<button id="fixture-iframe-button">Same-origin iframe button</button>
</body></html>`;

function FixtureApp() {
  return (
    <main id="fixture-ready">
      <style>{`
        :root { font-family: system-ui, sans-serif; color: #171717; background: #fafafa; }
        body { margin: 0; }
        main { display: grid; grid-template-columns: repeat(3, minmax(240px, 1fr)); gap: 18px; padding: 24px; }
        section { min-height: 96px; padding: 16px; border: 1px solid #d4d4d4; border-radius: 10px; background: white; }
        section > button, #fixture-portal-root button, #fixture-shadow-host { min-width: 170px; min-height: 44px; }
        .button-row { display: flex; flex-wrap: wrap; gap: 10px; }
        .overlay-target { position: relative; width: 210px; height: 54px; }
        .overlay-target button, #fixture-overlay { position: absolute; inset: 5px; }
        #fixture-overlay { position: fixed; inset: 0; z-index: 10; background: transparent; opacity: 0; pointer-events: auto; }
        #fixture-shadow-host { display: block; }
        iframe { width: 260px; height: 120px; border: 3px solid #737373; }
        #fixture-portal-root { position: fixed; right: 24px; bottom: 24px; z-index: 3; }
      `}</style>

      <section>
        <h1>React Grab public primitives</h1>
        <PlainButton />
      </section>

      <section className="button-row">
        <MemoButton />
        <ForwardRefButton />
      </section>

      <section className="button-row">
        {[1, 2, 3].map((index) => (
          <MappedItem key={index} index={index} />
        ))}
      </section>

      <section>
        <button id="fixture-svg-button">
          <svg
            width="32"
            height="32"
            viewBox="0 0 32 32"
            aria-hidden="true"
          >
            <path
              id="fixture-svg-path"
              d="M4 4h24v24H4z"
              fill="currentColor"
            />
          </svg>
          SVG button
        </button>
      </section>

      <section>
        <svg
          width="120"
          height="32"
          viewBox="0 0 120 32"
          aria-hidden="true"
        >
          <path
            id="fixture-svg-standalone-path"
            d="M4 4h112v24H4z"
            fill="#d4d4d4"
          />
        </svg>
      </section>

      <section>
        <div className="overlay-target">
          <button id="fixture-overlay-button">Button below overlay</button>
          <div
            id="fixture-overlay"
            aria-hidden="true"
          />
        </div>
      </section>

      <section>
        <OpenShadowFixture />
      </section>

      <section>
        <iframe
          id="fixture-iframe"
          title="Same-origin React Grab fixture"
          srcDoc={iframeDocument}
        />
      </section>

      <section>
        <Button id="fixture-shadcn-button">Template shadcn button</Button>
      </section>

      <PortalDialogAction />
    </main>
  );
}

const getElement = (id: string): Element => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing fixture element: ${id}`);
  return element;
};

const getShadowButton = (): Element => {
  const host = getElement("fixture-shadow-host");
  const button = host.shadowRoot?.getElementById("fixture-shadow-button");
  if (!button) throw new Error("Shadow fixture is not ready");
  return button;
};

const getIframeButton = (): Element => {
  const frame = getElement("fixture-iframe") as HTMLIFrameElement;
  const button = frame.contentDocument?.getElementById("fixture-iframe-button");
  if (!button) throw new Error("Iframe fixture is not ready");
  return button;
};

const inspectElement = async (element: Element): Promise<ElementProof> => {
  const inspected: InspectedElement = await inspectionEngine.inspect(element);
  return {
    id: element.id,
    tagName: inspected.tagName,
    selector: inspected.selector,
    bounds: inspected.bounds,
    componentName: inspected.componentName,
    filePath: inspected.source?.filePath ?? null,
    lineNumber: inspected.source?.lineNumber ?? null,
    columnNumber: inspected.source?.columnNumber ?? null,
    stack: inspected.sourceStack.map((frame) => ({ ...frame })),
  };
};

const center = (element: Element) => {
  const bounds = inspectionEngine.getBounds(element);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
};

const summarize = (element: Element | null) =>
  element
    ? { id: element.id, tagName: element.tagName.toLowerCase() }
    : null;

const hitElement = (element: Element, hideOverlay = false): HitProof => {
  const overlay = getElement("fixture-overlay") as HTMLElement;
  const previousDisplay = overlay.style.display;
  if (hideOverlay) overlay.style.display = "none";
  try {
    const point = center(element);
    const nativeTarget = document.elementFromPoint(point.x, point.y);
    const stack = inspectionEngine.getTargetsAtPoint(point.x, point.y);
    const selection = resolveUsefulTarget(point.x, point.y);
    const engineTarget = inspectionEngine.getTargetAtPoint(point.x, point.y);
    return {
      point,
      nativeTarget: nativeTarget
        ? {
            ...summarize(nativeTarget)!,
            grabbable: stack.includes(nativeTarget),
          }
        : null,
      selectedTarget: selection.target ? summarize(selection.target) : null,
      engineTarget: engineTarget ? summarize(engineTarget) : null,
      selectedStack: stack.map((candidate) => summarize(candidate)!),
      promoted: selection.promoted,
      promotionReason: selection.reason,
    };
  } finally {
    overlay.style.display = previousDisplay;
  }
};

const mountedUiAttributes = () => {
  const attributes = new Set<string>();
  const visit = (root: Document | ShadowRoot) => {
    for (const element of root.querySelectorAll("*")) {
      for (const attribute of element.getAttributeNames()) {
        if (attribute.startsWith("data-react-grab-")) {
          attributes.add(attribute);
        }
      }
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  };
  visit(document);
  return [...attributes].sort();
};

const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(<FixtureApp />);

window.__REACT_GRAB_G01__ = {
  engineSurface: {
    getTargetAtPoint: typeof inspectionEngine.getTargetAtPoint,
    getTargetsAtPoint: typeof inspectionEngine.getTargetsAtPoint,
    getBounds: typeof inspectionEngine.getBounds,
    inspect: typeof inspectionEngine.inspect,
    freeze: typeof inspectionEngine.freeze,
    unfreeze: typeof inspectionEngine.unfreeze,
    isFrozen: typeof inspectionEngine.isFrozen,
    resolveUsefulTarget: typeof resolveUsefulTarget,
  },
  inspect: (id) => inspectElement(getElement(id)),
  hit: (id, hideOverlay) => hitElement(getElement(id), hideOverlay),
  inspectShadow: () => inspectElement(getShadowButton()),
  hitShadow: (hideOverlay) => hitElement(getShadowButton(), hideOverlay),
  inspectIframe: () => inspectElement(getIframeButton()),
  hitIframe: (hideOverlay) => hitElement(getIframeButton(), hideOverlay),
  freezeCycle: () => {
    const bootstrap = window.__REACT_GRAB_G01_BOOTSTRAP__!;
    const errorCount = bootstrap.consoleErrors.length;
    const before = inspectionEngine.isFrozen();
    let during = false;
    try {
      inspectionEngine.freeze();
      during = inspectionEngine.isFrozen();
    } finally {
      inspectionEngine.unfreeze();
    }
    return {
      before,
      during,
      after: inspectionEngine.isFrozen(),
      consoleErrors: bootstrap.consoleErrors.slice(errorCount),
    };
  },
  uiState: () => {
    const bootstrap = window.__REACT_GRAB_G01_BOOTSTRAP__!;
    const copyEventAllowed = document.dispatchEvent(
      new Event("copy", { bubbles: true, cancelable: true })
    );
    const hotkeyEventAllowed = window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "c",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    return {
      mountedUiAttributes: mountedUiAttributes(),
      clipboardWrites: bootstrap.clipboardWrites,
      clipboardStubbed: bootstrap.clipboardStubbed,
      copyEventAllowed,
      hotkeyEventAllowed,
    };
  },
};
