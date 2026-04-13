/**
 * BrowserOpenHandler — detects browser open markers in terminal output
 * and opens URLs in the user's browser.
 *
 * The container outputs markers like:
 *   [[BROWSER_OPEN:https://github.com/login/device]]
 *
 * This handler scans incoming terminal data, extracts the URL, and
 * triggers window.open() to open the browser on the user's laptop.
 */

export interface BrowserOpenHandlerOptions {
  /** Called when a browser open request is detected */
  onBrowserOpen?: (url: string) => void;
}

/**
 * Scans terminal output for browser open markers.
 *
 * The marker format is: [[BROWSER_OPEN:<URL>]]
 * Example: [[BROWSER_OPEN:https://github.com/login/device]]
 */
export class BrowserOpenHandler {
  private buffer = "";
  private readonly markerStart = "[[BROWSER_OPEN:";
  private readonly markerEnd = "]]";

  constructor(private opts: BrowserOpenHandlerOptions = {}) {}

  /**
   * Process incoming terminal data.
   * @param data - Raw terminal output (can be string or Uint8Array)
   */
  process(data: string | Uint8Array): void {
    // Convert to string if needed
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);

    // Append to buffer
    this.buffer += text;

    // Scan for markers
    this.scanAndProcess();

    // Trim buffer if it gets too large to prevent memory growth
    if (this.buffer.length > 10000) {
      this.buffer = this.buffer.slice(-5000);
    }
  }

  private scanAndProcess(): void {
    let startIdx = this.buffer.indexOf(this.markerStart);

    while (startIdx !== -1) {
      const urlStart = startIdx + this.markerStart.length;
      const endIdx = this.buffer.indexOf(this.markerEnd, urlStart);

      if (endIdx === -1) {
        // Marker started but not complete yet - wait for more data
        break;
      }

      // Extract URL
      const url = this.buffer.slice(urlStart, endIdx).trim();

      // Validate it's a reasonable URL
      if (this.isValidUrl(url)) {
        this.openBrowser(url);
        this.opts.onBrowserOpen?.(url);
      }

      // Remove processed marker from buffer
      this.buffer = this.buffer.slice(0, startIdx) + this.buffer.slice(endIdx + this.markerEnd.length);

      // Look for next marker
      startIdx = this.buffer.indexOf(this.markerStart);
    }
  }

  private isValidUrl(url: string): boolean {
    // Basic validation - must start with http:// or https://
    return url.startsWith("http://") || url.startsWith("https://");
  }

  private openBrowser(url: string): void {
    try {
      // Open in new tab
      const opened = window.open(url, "_blank", "noopener,noreferrer");

      if (!opened) {
        console.warn("[ccccocc] Browser popup blocked. URL:", url);
      } else {
        console.log("[ccccocc] Opened browser:", url);
      }
    } catch (err) {
      console.error("[ccccocc] Failed to open browser:", err);
    }
  }

  /** Clear the internal buffer */
  reset(): void {
    this.buffer = "";
  }
}
