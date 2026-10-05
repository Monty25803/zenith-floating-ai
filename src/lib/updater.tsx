import { useCallback, useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type UpdateState =
  | { status: "idle" }
  | { status: "available"; version: string }
  | { status: "downloading"; version: string }
  | { status: "error"; message: string };

export function useAppUpdater(enabled: boolean) {
  const [state, setState] = useState<UpdateState>({ status: "idle" });

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const run = async () => {
      try {
        const update = await check();
        if (cancelled || !update) return;
        setState({ status: "available", version: update.version });
      } catch (err) {
        console.debug("Updater check skipped:", err);
      }
    };

    void run();
    const id = window.setInterval(() => void run(), 1000 * 60 * 60);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled]);

  const installUpdate = useCallback(async () => {
    if (state.status !== "available") return;
    const version = state.version;
    setState({ status: "downloading", version });
    try {
      const update = await check();
      if (!update) {
        setState({ status: "idle" });
        return;
      }
      await update.downloadAndInstall();
      await relaunch();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Update failed. Try again later.";
      setState({ status: "error", message });
    }
  }, [state]);

  const dismiss = useCallback(() => setState({ status: "idle" }), []);

  return { state, installUpdate, dismiss };
}

type UpdateAlertProps = {
  state: UpdateState;
  onUpdate: () => void;
  onDismiss: () => void;
};

export function UpdateAlert({ state, onUpdate, onDismiss }: UpdateAlertProps) {
  if (state.status === "idle") return null;

  if (state.status === "error") {
    return (
      <div className="zenith-banner zenith-banner--error flex justify-between gap-2 items-start">
        <span>{state.message}</span>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[0.6875rem] font-semibold text-red-200 underline shrink-0"
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (state.status === "downloading") {
    return (
      <div className="zenith-card text-[0.75rem] text-violet-100 flex items-center gap-2">
        <span className="zenith-btn__spinner" aria-hidden />
        Downloading v{state.version}… App will restart to finish.
      </div>
    );
  }

  return (
    <div className="zenith-card border-violet-500/30 bg-violet-950/40 text-[0.75rem] text-violet-50 flex flex-col gap-2.5">
      <p>
        <strong className="text-white font-semibold">Update available</strong> — Zenith v
        {state.version} is ready.
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={onUpdate} className="zenith-btn zenith-btn--primary">
          Update now
        </button>
        <button type="button" onClick={onDismiss} className="zenith-btn zenith-btn--ghost">
          Later
        </button>
      </div>
    </div>
  );
}
