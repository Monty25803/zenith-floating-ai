import { useRef } from "react";
import { ZenithMark } from "../brand/ZenithMark";

type PanelHeaderProps = {
  subtitle: string;
  onMinimize: () => void;
  onQuit: () => void;
  onCollapseDrag?: () => void;
  onSettings?: () => void;
  onBack?: () => void;
};

export function PanelHeader({
  subtitle,
  onMinimize,
  onQuit,
  onCollapseDrag,
  onSettings,
  onBack,
}: PanelHeaderProps) {
  const gripStartY = useRef<number | null>(null);

  return (
    <>
      <header className="zenith-header" data-tauri-drag-region>
        <div className="flex items-center gap-3 min-w-0 pointer-events-none">
          <ZenithMark className="h-10 w-10 shrink-0 shadow-md ring-1 ring-white/10" />
          <div className="min-w-0">
            <div className="zenith-brand__title">Zenith</div>
            <div className="zenith-brand__tagline truncate">{subtitle}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onSettings && (
            <button type="button" className="zenith-btn zenith-btn--ghost" onClick={onSettings}>
              Settings
            </button>
          )}
          {onBack && (
            <button type="button" className="zenith-btn zenith-btn--ghost" onClick={onBack}>
              Back
            </button>
          )}
          <button
            type="button"
            title="Collapse to floating icon"
            className="zenith-btn zenith-btn--ghost"
            onClick={onMinimize}
          >
            Minimize
          </button>
          <button
            type="button"
            title="Quit Zenith completely"
            className="zenith-btn zenith-btn--danger"
            onClick={onQuit}
          >
            Quit
          </button>
        </div>
      </header>
      {onCollapseDrag && (
        <button
          type="button"
          className="zenith-collapse-grip"
          title="Drag down or click to collapse"
          aria-label="Collapse to bubble"
          onClick={onMinimize}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            gripStartY.current = e.clientY;
          }}
          onPointerMove={(e) => {
            if (gripStartY.current == null) return;
            if (e.clientY - gripStartY.current > 48) {
              gripStartY.current = null;
              onCollapseDrag();
            }
          }}
          onPointerUp={() => {
            gripStartY.current = null;
          }}
        >
          <span className="zenith-collapse-grip__bar" />
        </button>
      )}
    </>
  );
}
