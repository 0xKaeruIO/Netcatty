import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { runWithAct } from "../test-support/renderReactDom.tsx";

const setupDom = () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
    url: "http://localhost",
  });
  const window = dom.window;
  const previousGlobals = new Map<string, PropertyDescriptor | undefined>();
  const installGlobal = (key: string, value: unknown) => {
    previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };

  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  Object.assign(window.Range.prototype, {
    getClientRects: () => [],
    getBoundingClientRect: () => new window.DOMRect(),
  });

  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });

  for (const [key, value] of Object.entries({
    window,
    Window: window.Window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    HTMLSelectElement: window.HTMLSelectElement,
    Element: window.Element,
    Node: window.Node,
    Text: window.Text,
    Range: window.Range,
    NodeFilter: window.NodeFilter,
    MutationObserver: window.MutationObserver,
    Event: window.Event,
    KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent,
    DOMRect: window.DOMRect,
    getSelection: () => window.getSelection(),
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0),
    cancelAnimationFrame: (id: number) => window.clearTimeout(id),
    ResizeObserver: ResizeObserverStub,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    installGlobal(key, value);
  }

  return {
    window,
    cleanup: () => {
      for (const [key, descriptor] of previousGlobals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
      window.close();
    },
  };
};

const renderEditor = async (
  window: Window & typeof globalThis,
  props: { value: string; editorMode?: "edit" | "preview" | "source" },
) => {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { I18nProvider } = await import("../../application/i18n/I18nProvider.tsx");
  const { TooltipProvider } = await import("../ui/tooltip.tsx");
  const { InlineMarkdownEditor } = await import("./InlineMarkdownEditor.tsx");

  const rootNode = window.document.getElementById("root");
  assert.ok(rootNode);
  const root = createRoot(rootNode);
  const render = async (nextProps: typeof props) => act(async () => {
    root.render(
      <I18nProvider locale="en">
        <TooltipProvider>
          <InlineMarkdownEditor
            noteId="note-find"
            value={nextProps.value}
            placeholder="Write Markdown notes here..."
            editorMode={nextProps.editorMode ?? "edit"}
            onChange={() => undefined}
            hosts={[]}
          />
        </TooltipProvider>
      </I18nProvider>,
    );
  });
  await render(props);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return {
    rootNode,
    rerender: render,
    async unmount() {
      await act(async () => {
        root.unmount();
      });
    },
  };
};

const dispatchFindHotkey = (window: Window, target: Element) => {
  target.dispatchEvent(new window.KeyboardEvent("keydown", {
    key: "f",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  }));
};

const setFindInputValue = (
  window: Window,
  input: HTMLInputElement,
  value: string,
) => {
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  assert.ok(setValue);
  setValue.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
};

test("source mode Ctrl+F opens in-note find and counts matches", async () => {
  const { window, cleanup } = setupDom();
  try {
    const value = "alpha hello\nhello world";
    const { rootNode, unmount } = await renderEditor(window, { value, editorMode: "source" });
    try {
      const editor = rootNode.querySelector("[data-note-editor]");
      assert.ok(editor);
      await runWithAct(async () => {
        dispatchFindHotkey(window, editor);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      const input = rootNode.querySelector<HTMLInputElement>("[data-note-find-input]");
      assert.ok(input, "expected the in-note find bar");
      await runWithAct(async () => {
        setFindInputValue(window, input, "hello");
      });
      const count = rootNode.querySelector("[data-note-find-count]");
      assert.match(count?.textContent ?? "", /1 \/ 2/);
      assert.ok(rootNode.querySelector("[data-note-find-overlay]"));
    } finally {
      await unmount();
    }
  } finally {
    cleanup();
  }
});

test("leaving source mode closes the in-note find bar", async () => {
  const { window, cleanup } = setupDom();
  try {
    const value = "alpha hello\nhello world";
    const { rootNode, rerender, unmount } = await renderEditor(window, { value, editorMode: "source" });
    try {
      const editor = rootNode.querySelector("[data-note-editor]");
      assert.ok(editor);
      await runWithAct(async () => {
        dispatchFindHotkey(window, editor);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      assert.ok(rootNode.querySelector("[data-note-find-input]"));
      await rerender({ value, editorMode: "preview" });
      await runWithAct(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      assert.equal(rootNode.querySelector("[data-note-find-input]"), null);
    } finally {
      await unmount();
    }
  } finally {
    cleanup();
  }
});

test("preview and edit modes do not open in-note find with Ctrl+F", async () => {
  const { window, cleanup } = setupDom();
  try {
    const value = "# Heading\n\nSearchable paragraph.";
    const { rootNode, rerender, unmount } = await renderEditor(window, { value, editorMode: "preview" });
    try {
      const editor = rootNode.querySelector("[data-note-editor]");
      assert.ok(editor);
      await runWithAct(async () => {
        dispatchFindHotkey(window, editor);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      assert.equal(rootNode.querySelector("[data-note-find-input]"), null);

      await rerender({ value, editorMode: "edit" });
      await runWithAct(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      const editorAfter = rootNode.querySelector("[data-note-editor]");
      assert.ok(editorAfter);
      await runWithAct(async () => {
        dispatchFindHotkey(window, editorAfter);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      assert.equal(rootNode.querySelector("[data-note-find-input]"), null);
    } finally {
      await unmount();
    }
  } finally {
    cleanup();
  }
});
