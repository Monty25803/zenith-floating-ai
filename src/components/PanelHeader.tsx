import { ZenithMark } from "../brand/ZenithMark";

type PanelHeaderProps = {
  subtitle: string;
  onClose: () => void;
  onSettings?: () => void;
  onBack?: () => void;
};

export function PanelHeader({
  subtitle,
  onClose,
  onSettings,
  onBack,
}: PanelHeaderProps) {
  return (
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
        <button type="button" className="zenith-btn zenith-btn--ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </header>
  );
}
