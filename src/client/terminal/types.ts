/**
 * Terminal adapter interface.
 *
 * Abstracts the concrete terminal renderer (ghostty-web) so it can be
 * swapped for another xterm.js-compatible library with minimal changes.
 */
export interface ITerminalAdapter {
  /** Mount the terminal into a DOM container. */
  mount(container: HTMLElement): void;

  /** Write data (bytes or string) to the terminal display. */
  write(data: string | Uint8Array): void;

  /** Register a callback for user keyboard input. */
  onInput(callback: (data: string) => void): void;

  /** Register a callback for terminal resize events (triggered by fit). */
  onResize(callback: (cols: number, rows: number) => void): void;

  /** Recompute dimensions to fill the container. */
  fit(): void;

  /** Reset terminal state (screen, cursor, scrollback). */
  reset(): void;

  /** Focus the terminal element. */
  focus(): void;

  /** Current column count. */
  readonly cols: number;

  /** Current row count. */
  readonly rows: number;

  /** Tear down the terminal and release all resources. */
  dispose(): void;
}
