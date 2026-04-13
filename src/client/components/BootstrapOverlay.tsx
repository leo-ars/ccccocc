import { useState, useEffect } from "react";

const BOOT_HINT_DELAY_MS = 5_000;

interface BootstrapOverlayProps {
  reconnecting?: boolean;
}

/**
 * Prominent overlay shown over the terminal area while the WebSocket
 * connection is being established. If connecting takes longer than 5 s
 * (typical for a cold container boot), a secondary hint is shown.
 */
export function BootstrapOverlay({ reconnecting }: BootstrapOverlayProps) {
  const [showBootHint, setShowBootHint] = useState(false);

  useEffect(() => {
    // Only show the "container booting" hint on first connect, not reconnects
    if (reconnecting) {
      setShowBootHint(false);
      return;
    }
    const timer = setTimeout(() => setShowBootHint(true), BOOT_HINT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [reconnecting]);

  return (
    <div className="bootstrap-overlay">
      <div className="bootstrap-content">
        <div className="bootstrap-spinner" />
        <div className="bootstrap-message">
          {reconnecting ? "Reconnecting to session\u2026" : "Connecting to container\u2026"}
        </div>
        {showBootHint && <div className="bootstrap-hint">Container is starting up — this can take a moment</div>}
      </div>
    </div>
  );
}
