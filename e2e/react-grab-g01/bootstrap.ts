type BootstrapState = {
  clipboardWrites: number;
  clipboardStubbed: boolean;
  consoleErrors: string[];
};

if (!import.meta.env.DEV || import.meta.env.MODE !== "e2e") {
  throw new Error("React Grab Goal 01 fixture is available only in E2E dev mode");
}

const state: BootstrapState = {
  clipboardWrites: 0,
  clipboardStubbed: false,
  consoleErrors: [],
};

(window as Window & { __REACT_GRAB_G01_BOOTSTRAP__?: BootstrapState })
  .__REACT_GRAB_G01_BOOTSTRAP__ = state;

const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  state.consoleErrors.push(args.map(String).join(" "));
  originalConsoleError(...args);
};

try {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => {
        state.clipboardWrites += 1;
      },
    },
  });
  state.clipboardStubbed = true;
} catch {
  // Clipboard can be non-configurable in some browsers. The copy-event
  // cancellation assertion still proves that primitives install no handler.
}

void import("./fixture").catch((error: unknown) => {
  console.error("React Grab Goal 01 fixture failed to load", error);
});
