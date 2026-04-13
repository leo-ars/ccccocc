// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state: {
    lastTerminal: MockTerminal | null;
    lastFitAddon: MockFitAddon | null;
  } = {
    lastTerminal: null,
    lastFitAddon: null,
  };

  class MockTerminal {
    cols = 80;
    rows = 24;
    customKeyHandler: ((event: KeyboardEvent) => boolean) | null = null;
    hasSelection = vi.fn(() => false);
    input = vi.fn();
    loadAddon = vi.fn();
    open = vi.fn();
    write = vi.fn();
    onData = vi.fn();
    onResize = vi.fn();
    reset = vi.fn();
    focus = vi.fn();
    dispose = vi.fn();

    constructor(_options: unknown) {
      state.lastTerminal = this;
    }

    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void {
      this.customKeyHandler = handler;
    }
  }

  class MockFitAddon {
    fit = vi.fn();

    constructor() {
      state.lastFitAddon = this;
    }
  }

  return { state, MockTerminal, MockFitAddon };
});

vi.mock("ghostty-web", () => ({
  Terminal: mocks.MockTerminal,
  FitAddon: mocks.MockFitAddon,
}));

import { GhosttyTerminalAdapter } from "../src/client/terminal/adapter";

describe("GhosttyTerminalAdapter", () => {
  beforeEach(() => {
    mocks.state.lastTerminal = null;
    mocks.state.lastFitAddon = null;
    vi.clearAllMocks();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
  });

  it("maps Ctrl+C to ETX input", () => {
    const adapter = new GhosttyTerminalAdapter();
    const container = document.createElement("div");
    adapter.mount(container);

    expect(mocks.state.lastTerminal).not.toBeNull();
    const handled = mocks.state.lastTerminal!.customKeyHandler!(
      new KeyboardEvent("keydown", {
        key: "c",
        ctrlKey: true,
      }),
    );

    expect(handled).toBe(true);
    expect(mocks.state.lastTerminal!.input).toHaveBeenCalledWith("\x03", true);
  });

  it("lets Ctrl+V pass through unchanged", () => {
    const adapter = new GhosttyTerminalAdapter();
    const container = document.createElement("div");
    adapter.mount(container);

    expect(mocks.state.lastTerminal).not.toBeNull();
    const handled = mocks.state.lastTerminal!.customKeyHandler!(
      new KeyboardEvent("keydown", {
        key: "v",
        ctrlKey: true,
      }),
    );

    expect(handled).toBe(false);
    expect(mocks.state.lastTerminal!.input).not.toHaveBeenCalled();
  });

  it("does not synthesize Ctrl+C when terminal text is selected", () => {
    const adapter = new GhosttyTerminalAdapter();
    const container = document.createElement("div");
    adapter.mount(container);

    expect(mocks.state.lastTerminal).not.toBeNull();
    mocks.state.lastTerminal!.hasSelection.mockReturnValue(true);
    const handled = mocks.state.lastTerminal!.customKeyHandler!(
      new KeyboardEvent("keydown", {
        key: "c",
        ctrlKey: true,
      }),
    );

    expect(handled).toBe(false);
    expect(mocks.state.lastTerminal!.input).not.toHaveBeenCalled();
  });

  it("prepares initial dimensions before attach", async () => {
    const adapter = new GhosttyTerminalAdapter();
    const container = document.createElement("div");
    adapter.mount(container);

    expect(mocks.state.lastTerminal).not.toBeNull();
    expect(mocks.state.lastFitAddon).not.toBeNull();

    vi.clearAllMocks();
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });

    mocks.state.lastFitAddon!.fit.mockImplementation(() => {
      mocks.state.lastTerminal!.cols = 132;
      mocks.state.lastTerminal!.rows = 38;
    });

    const result = await adapter.prepareForAttach();

    expect(mocks.state.lastFitAddon!.fit).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ cols: 132, rows: 38 });
  });
});
