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
      <div className="mt-3 p-3 rounded-xl bg-red-950/50 border border-red-800/50 text-xs text-red-100 flex justify-between gap-2 items-start">
        <span>{state.message}</span>
        <button type="button" onClick={onDismiss} className="underline shrink-0">
          Dismiss
        </button>
      </div>
    );
  }

  if (state.status === "downloading") {
    return (
      <div className="mt-3 p-3 rounded-xl bg-violet-950/50 border border-violet-700/40 text-xs text-violet-100">
        Downloading Zenith v{state.version}... The app will restart to finish
        installing.
      </div>
    );
  }

  return (
    <div className="mt-3 p-3 rounded-xl bg-violet-950/60 border border-violet-600/50 text-xs text-violet-50 flex flex-col gap-2">
      <p>
        <strong className="text-white">Update available</strong> - Zenith v
        {state.version} is ready. Install now to get the latest fixes.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onUpdate}
          className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium"
        >
          Update now
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
        >
          Later
        </button>
      </div>
    </div>
  );
}
