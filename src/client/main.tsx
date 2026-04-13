import { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./App.css";

// ghostty-web requires WASM initialisation before any Terminal is created.
// Instead of blocking the React tree on init(), we render immediately and
// show a loading screen until the WASM module is ready.
import { init } from "ghostty-web";

function Root() {
  const [wasmReady, setWasmReady] = useState(false);
  const [wasmError, setWasmError] = useState<string | null>(null);

  useEffect(() => {
    init()
      .then(() => setWasmReady(true))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setWasmError(msg);
      });
  }, []);

  if (wasmError) {
    return (
      <div className="app">
        <div className="bootstrap-screen">
          <div className="bootstrap-content">
            <div className="bootstrap-error">Failed to initialize terminal: {wasmError}</div>
          </div>
        </div>
      </div>
    );
  }

  if (!wasmReady) {
    return (
      <div className="app">
        <div className="bootstrap-screen">
          <div className="bootstrap-content">
            <div className="bootstrap-spinner" />
            <div className="bootstrap-message">Initializing terminal&hellip;</div>
          </div>
        </div>
      </div>
    );
  }

  return <App />;
}

const el = document.getElementById("root");
if (!el) throw new Error("Missing #root element");
createRoot(el).render(<Root />);
