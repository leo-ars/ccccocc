/**
 * Terminal adapter backed by ghostty-web.
 *
 * ghostty-web exposes an xterm.js-compatible API surface (Terminal class,
 * onData / onResize events, loadAddon, FitAddon). WASM must be initialised
 * via `await init()` before the first Terminal is created — that happens
 * once in main.tsx.
 */
import { Terminal, FitAddon } from "ghostty-web";
import type { ITerminalAdapter } from "./types";

export interface TerminalAdapterOptions {
  cursorBlink?: boolean;
  fontSize?: number;
  fontFamily?: string;
}

export class GhosttyTerminalAdapter implements ITerminalAdapter {
  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private disposables: Array<{ dispose(): void }> = [];
  private renderFrameId: number | null = null;
  private pendingFullRender = false;
  private blinkIntervalId: number | null = null;

  constructor(private opts: TerminalAdapterOptions = {}) {}

  get cols(): number {
    return this.terminal?.cols ?? 80;
  }

  get rows(): number {
    return this.terminal?.rows ?? 24;
  }

  mount(container: HTMLElement): void {
    if (this.terminal) return;

    this.terminal = new Terminal({
      cursorBlink: this.opts.cursorBlink ?? true,
      fontSize: this.opts.fontSize ?? 14,
      fontFamily: this.opts.fontFamily ?? "Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
      scrollback: 10_000,
      theme: {
        background: "#1a1a2e",
        foreground: "#e0e0e0",
        cursor: "#e0e0e0",
        selectionBackground: "#0f346080",
      },
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.open(container);
    this.disableContinuousRenderLoop();
    this.scheduleRender(true);
    this.startCursorBlinkRendering();

    // ghostty-web's WASM key encoder may not reliably produce control codes
    // for Ctrl+letter combinations, and the contenteditable container can
    // cause the browser to intercept Ctrl+C as clipboard copy. Handle
    // Ctrl+letter directly: emit the control code via terminal.input() and
    // return true to suppress ghostty-web's default handling.
    const term = this.terminal;
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type !== "keydown") return false;

      // Let Ctrl+V / Cmd+V through for browser paste
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
        return false;
      }

      // Ctrl+C with an active selection → let browser copy
      if (event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "c" && term.hasSelection()) {
        return false;
      }

      // Ctrl+letter → emit control code directly (Ctrl+A=\x01 … Ctrl+Z=\x1a)
      if (event.ctrlKey && !event.altKey && !event.metaKey) {
        const key = event.key.toLowerCase();
        if (key.length === 1 && key >= "a" && key <= "z") {
          const code = key.charCodeAt(0) - 96; // 'a'=97 → 1, 'c'=99 → 3
          term.input(String.fromCharCode(code), true);
          return true;
        }
      }

      return false;
    });

    const schedulePointerRender = () => this.scheduleRender();
    container.addEventListener("mousemove", schedulePointerRender);
    container.addEventListener("mouseleave", schedulePointerRender);
    this.disposables.push({
      dispose: () => {
        container.removeEventListener("mousemove", schedulePointerRender);
        container.removeEventListener("mouseleave", schedulePointerRender);
      },
    });

    const scrollDisposable = this.getInternalTerminal()?.onScroll?.(() => {
      this.scheduleRender();
    });
    if (scrollDisposable) this.disposables.push(scrollDisposable);

    const selectionDisposable = this.getInternalTerminal()?.onSelectionChange?.(() => {
      this.scheduleRender();
    });
    if (selectionDisposable) this.disposables.push(selectionDisposable);

    const scheduleVisibilityRender = () => this.scheduleRender();
    document.addEventListener("visibilitychange", scheduleVisibilityRender);
    container.addEventListener("focusin", scheduleVisibilityRender);
    container.addEventListener("focusout", scheduleVisibilityRender);
    this.disposables.push({
      dispose: () => {
        document.removeEventListener("visibilitychange", scheduleVisibilityRender);
        container.removeEventListener("focusin", scheduleVisibilityRender);
        container.removeEventListener("focusout", scheduleVisibilityRender);
      },
    });

    // Delay initial fit until the container has paint dimensions.
    requestAnimationFrame(() => this.fitAddon?.fit());
  }

  write(data: string | Uint8Array): void {
    this.terminal?.write(data);
    this.scheduleRender();
  }

  onInput(callback: (data: string) => void): void {
    const d = this.terminal?.onData(callback);
    if (d) this.disposables.push(d);
  }

  onResize(callback: (cols: number, rows: number) => void): void {
    const d = this.terminal?.onResize(({ cols, rows }: { cols: number; rows: number }) => callback(cols, rows));
    if (d) this.disposables.push(d);
  }

  fit(): void {
    this.fitAddon?.fit();
  }

  async prepareForAttach(): Promise<{ cols: number; rows: number }> {
    // The first fit can race with canvas metrics and font readiness.
    // Retry before opening the PTY so full-screen TUIs start at the
    // correct size instead of staying at the worker's 80x24 default.
    this.fit();
    await nextAnimationFrame();
    this.fit();
    await waitForFontsReady();
    await nextAnimationFrame();
    this.fit();

    return {
      cols: this.cols,
      rows: this.rows,
    };
  }

  reset(): void {
    this.terminal?.reset();
    this.scheduleRender(true);
  }

  focus(): void {
    this.terminal?.focus();
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    if (this.renderFrameId !== null) {
      cancelAnimationFrame(this.renderFrameId);
      this.renderFrameId = null;
    }
    if (this.blinkIntervalId !== null) {
      clearInterval(this.blinkIntervalId);
      this.blinkIntervalId = null;
    }
    this.pendingFullRender = false;
    this.fitAddon = null;
    this.terminal?.dispose();
    this.terminal = null;
  }

  private getInternalTerminal(): GhosttyTerminalInternal | null {
    return this.terminal as GhosttyTerminalInternal | null;
  }

  private disableContinuousRenderLoop(): void {
    const terminal = this.getInternalTerminal();
    if (!terminal) return;

    if (typeof terminal.animationFrameId === "number") {
      cancelAnimationFrame(terminal.animationFrameId);
      terminal.animationFrameId = undefined;
    }

    terminal.startRenderLoop = () => {
      // Disabled intentionally. This adapter drives rendering on demand to
      // avoid an otherwise perpetual animation frame loop while idle.
    };
  }

  private startCursorBlinkRendering(): void {
    if (!this.opts.cursorBlink || this.blinkIntervalId !== null) {
      return;
    }

    this.blinkIntervalId = window.setInterval(() => {
      if (!this.shouldRenderCursorBlink()) {
        return;
      }
      this.scheduleRender();
    }, 530);
  }

  private shouldRenderCursorBlink(): boolean {
    if (document.visibilityState !== "visible") {
      return false;
    }

    const terminal = this.getInternalTerminal();
    const element = terminal?.element;
    if (!element) {
      return false;
    }

    const activeElement = document.activeElement;
    return !!activeElement && (activeElement === element || element.contains(activeElement));
  }

  private scheduleRender(forceAll = false): void {
    this.pendingFullRender = this.pendingFullRender || forceAll;

    if (this.renderFrameId !== null) {
      return;
    }

    this.renderFrameId = requestAnimationFrame(() => {
      this.renderFrameId = null;
      const shouldForceAll = this.pendingFullRender;
      this.pendingFullRender = false;
      this.render(shouldForceAll);
    });
  }

  private render(forceAll = false): void {
    const terminal = this.getInternalTerminal();
    if (!terminal?.renderer || !terminal.wasmTerm) {
      return;
    }

    terminal.renderer.render(terminal.wasmTerm, forceAll, terminal.viewportY, terminal, terminal.scrollbarOpacity);

    const cursor = terminal.wasmTerm.getCursor?.();
    if (cursor && cursor.y !== terminal.lastCursorY) {
      terminal.lastCursorY = cursor.y;
      terminal.cursorMoveEmitter?.fire();
    }
  }
}

interface GhosttyRenderEmitter {
  fire(): void;
}

interface GhosttyRenderDisposable {
  dispose(): void;
}

interface GhosttyRenderer {
  render(
    buffer: unknown,
    forceAll?: boolean,
    viewportY?: number,
    scrollbackProvider?: unknown,
    scrollbarOpacity?: number,
  ): void;
}

interface GhosttyWasmTerminal {
  getCursor?(): { y: number };
}

interface GhosttyTerminalInternal {
  animationFrameId?: number;
  cursorMoveEmitter?: GhosttyRenderEmitter;
  element?: HTMLElement;
  lastCursorY: number;
  onScroll?: (listener: () => void) => GhosttyRenderDisposable;
  onSelectionChange?: (listener: () => void) => GhosttyRenderDisposable;
  renderer?: GhosttyRenderer;
  scrollbarOpacity: number;
  startRenderLoop?: () => void;
  viewportY: number;
  wasmTerm?: GhosttyWasmTerminal;
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 16);
  });
}

async function waitForFontsReady(timeoutMs = 250): Promise<void> {
  const fonts = (
    document as Document & {
      fonts?: { ready?: Promise<unknown> };
    }
  ).fonts;
  const ready = fonts?.ready;
  if (!ready) return;

  try {
    await Promise.race([ready.then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
  } catch {
    // Best-effort only. If font loading fails, fall back to the current size.
  }
}
