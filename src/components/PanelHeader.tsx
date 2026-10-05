import { ZenithMark } from "../brand/ZenithMark";

type PanelHeaderProps = {
  subtitle: string;
  orbState?: "idle" | "thinking" | "success" | "error";
  onMinimize: () => void;
  onQuit: () => void;
  onCollapseDrag?: () => void;
  onSettings?: () => void;
  onBack?: () => void;
};

export function PanelHeader({
  subtitle,
  orbState = "idle",
  onMinimize,
  onQuit,
  onCollapseDrag,
  onSettings,
  onBack,
}: PanelHeaderProps) {
  return (
    <>
      <header className="zenith-header" data-tauri-drag-region>
        <div className="flex items-center gap-3 min-w-0 pointer-events-none">
          <ZenithMark
            variant="orb"
            className={`h-10 w-10 shrink-0 zenith-header-orb zenith-header-orb--${orbState}`}
          />
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
            const startY = e.clientY;
            const el = e.currentTarget;
            el.setPointerCapture(e.pointerId);
            const onMove = (ev: PointerEvent) => {
              if (ev.clientY - startY > 48) {
                el.releasePointerCapture(e.pointerId);
                el.removeEventListener("pointermove", onMove);
                onCollapseDrag();
              }
            };
            el.addEventListener("pointermove", onMove);
            el.addEventListener(
              "pointerup",
              () => el.removeEventListener("pointermove", onMove),
              { once: true },
            );
          }}
        >
          <span className="zenith-collapse-grip__bar" />
        </button>
      )}
    </>
  );
}
