import { useEffect, type ReactNode } from "react";
import { useI18n } from "./i18n";

interface OverlayProps {
  onClose: () => void;
  children: ReactNode;
  className?: string;
  showCloseButton?: boolean;
}

export function Overlay({ onClose, children, className = "", showCloseButton = true }: OverlayProps) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className={`overlay-content ${className}`}>
        {showCloseButton && (
          <button className="overlay-close-button" onClick={onClose} aria-label={t.close}>
            ✕
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
