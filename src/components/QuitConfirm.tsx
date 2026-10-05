type QuitConfirmProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function QuitConfirm({ open, onCancel, onConfirm }: QuitConfirmProps) {
  if (!open) return null;

  return (
    <div className="zenith-modal" role="dialog" aria-modal="true" aria-labelledby="quit-title">
      <div className="zenith-modal__card">
        <h2 id="quit-title" className="zenith-modal__title">
          Quit Zenith?
        </h2>
        <p className="zenith-modal__body">
          The floating assistant will close completely. You can launch it again from the Start Menu
          or desktop shortcut.
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="zenith-btn zenith-btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="zenith-btn zenith-btn--danger" onClick={onConfirm}>
            Quit
          </button>
        </div>
      </div>
    </div>
  );
}
