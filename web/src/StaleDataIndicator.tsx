import { useEffect, useRef, useState } from "react";
import { formatDuration } from "./formatDuration";
import { useI18n } from "./i18n";

// Client-side stale-data indicator. The upstream client shows the indicator
// after 30 s and colors it red after 180 s; the server treats a 120 s gap as
// stale for its own monitoring. All three thresholds are confirmed from the
// upstream code (StaleDataIndicator.tsx, webserver.py).

const STALE_THRESHOLD_SECONDS = 30;
const CRITICAL_THRESHOLD_SECONDS = 180;

export function StaleDataIndicator({ lastUpdateTime }: { lastUpdateTime: number | null }) {
  const { t } = useI18n();
  const [elapsed, setElapsed] = useState(0);
  const [showMessage, setShowMessage] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tick = () => {
      if (lastUpdateTime != null) setElapsed(Math.floor((Date.now() - lastUpdateTime) / 1000));
    };
    tick();
    const interval = window.setInterval(tick, showMessage ? 1000 : 5000);
    return () => window.clearInterval(interval);
  }, [lastUpdateTime, showMessage]);

  useEffect(() => {
    if (!showMessage) return;
    const onMouseDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowMessage(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [showMessage]);

  if (lastUpdateTime == null || elapsed < STALE_THRESHOLD_SECONDS) return null;

  const colorClass =
    elapsed >= CRITICAL_THRESHOLD_SECONDS ? "stale-dot-red" : "stale-dot-orange";

  return (
    <div className="stale-indicator" ref={containerRef}>
      <div
        className={`stale-dot ${colorClass}`}
        onClick={() => setShowMessage((value) => !value)}
        onMouseEnter={() => setShowMessage(true)}
        onMouseLeave={() => setShowMessage(false)}
      />
      {showMessage && <div className="stale-message">{t.stale(formatDuration(elapsed))}</div>}
    </div>
  );
}
