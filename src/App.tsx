import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ZenithMark } from "./brand/ZenithMark";
import { getApiKey, maskApiKey, setApiKey } from "./lib/apiKey";
import { placeBubble, placePanel } from "./lib/windowModes";

import { refactorDraft } from "./lib/gemini";
import { UpdateAlert, useAppUpdater } from "./lib/updater";

const API_KEY_HELP_URL = "https://aistudio.google.com/apikey";

type View = "bubble" | "panel" | "settings";

export default function App() {
  const [view, setView] = useState<View>("bubble");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingHint, setLoadingHint] = useState("");
  const [output, setOutput] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const appWindow = getCurrentWindow();
  const pointerDownAt = useRef<{ x: number; y: number; t: number } | null>(null);
  const { state: updateState, installUpdate, dismiss: dismissUpdate } =
    useAppUpdater(true);

  useEffect(() => {
    const fromEnv = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim();
    if (!getApiKey() && fromEnv) {
      setApiKey(fromEnv);
    }
    const existing = getApiKey();
    setHasKey(Boolean(existing));
    setApiKeyDraft(existing);
    void (async () => {
      await placeBubble();
      await appWindow.show();
      await appWindow.setFocus();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && view !== "bubble") {
        e.preventDefault();
        void collapseToBubble();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const collapseToBubble = async () => {
    setInput("");
    setOutput("");
    setCopied(false);
    setError("");
    setView("bubble");
    await placeBubble();
  };

  const openPanel = async () => {
    setView("panel");
    await placePanel();
    await appWindow.setFocus();
    setTimeout(() => inputRef.current?.focus(), 80);
  };

  const openSettings = async () => {
    setApiKeyDraft(getApiKey());
    setApiKeySaved(false);
    setShowKey(false);
    setView("settings");
    await placePanel();
    await appWindow.setFocus();
  };

  const handleBubblePointerDown = (e: ReactPointerEvent) => {
    pointerDownAt.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  };

  const handleBubblePointerUp = (e: ReactPointerEvent) => {
    const start = pointerDownAt.current;
    pointerDownAt.current = null;
    if (!start) return;
    const moved =
      Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6 ||
      Date.now() - start.t > 350;
    if (moved) return;
    void openPanel();
  };

  const handleBubblePointerMove = async (e: ReactPointerEvent) => {
    const start = pointerDownAt.current;
    if (!start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) {
      pointerDownAt.current = null;
      await appWindow.startDragging();
    }
  };

  const saveKey = () => {
    setApiKey(apiKeyDraft);
    const saved = Boolean(getApiKey());
    setHasKey(saved);
    setApiKeySaved(true);
    setTimeout(() => setApiKeySaved(false), 2000);
  };

  const clearKey = () => {
    setApiKey("");
    setApiKeyDraft("");
    setHasKey(false);
    setApiKeySaved(false);
  };

  const handleRefactor = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const apiKey = getApiKey();
    if (!apiKey) {
      setError("Add your Gemini API key in Settings first.");
      setView("settings");
      return;
    }

    setLoading(true);
    setLoadingHint("");
    setOutput("");
    setCopied(false);
    setError("");

    try {
      const generatedText = await refactorDraft(apiKey, input, (p) => {
        setLoadingHint(
          p.attempt > 1
            ? `Retrying (${p.attempt}/${p.maxAttempts})…`
            : "",
        );
      });

      setOutput(generatedText);
      await writeText(generatedText);
      setCopied(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error communicating with AI service.";
      setError(message);
    } finally {
      setLoading(false);
      setLoadingHint("");
    }
  };

  const handleCopy = async () => {
    if (!output) return;
    await writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTextareaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handleRefactor(e as unknown as FormEvent);
    }
  };

  if (view === "bubble") {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-transparent">
        <button
          type="button"
          aria-label="Open Zenith AI Assistant"
          onPointerDown={handleBubblePointerDown}
          onPointerMove={(e) => void handleBubblePointerMove(e)}
          onPointerUp={handleBubblePointerUp}
          className="zenith-bubble h-[64px] w-[64px] rounded-[22%] flex items-center justify-center cursor-pointer overflow-hidden bg-transparent shadow-none ring-0 border-0 outline-none hover:scale-105 active:scale-95 transition-transform"
        >
          <ZenithMark className="h-full w-full rounded-[22%] pointer-events-none shadow-none" />
          {!hasKey && (
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-slate-950" />
          )}
          {hasKey && updateState.status === "available" && (
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-950" />
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-slate-900/85 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 flex flex-col text-slate-100 shadow-2xl select-none">
      <div
        className="flex justify-between items-center pb-3 border-b border-slate-700/40"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-3 pointer-events-none min-w-0">
          <ZenithMark className="h-10 w-10 shrink-0" />
          <div className="flex flex-col leading-tight min-w-0">
            <span className="text-sm font-semibold tracking-tight text-white">
              Zenith
            </span>
            <span className="text-[10px] font-medium text-violet-200/80 truncate">
              {view === "settings"
                ? "Settings"
                : "The peak of your productivity stack"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {view === "panel" && (
            <button
              type="button"
              onClick={() => void openSettings()}
              className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 transition"
              title="API key settings"
            >
              Settings
            </button>
          )}
          {view === "settings" && (
            <button
              type="button"
              onClick={() => setView("panel")}
              className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 transition"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={() => void collapseToBubble()}
            className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 transition"
          >
            Close
          </button>
        </div>
      </div>

      <UpdateAlert
        state={updateState}
        onUpdate={() => void installUpdate()}
        onDismiss={dismissUpdate}
      />

      {view === "settings" ? (
        <div className="mt-3 flex flex-col flex-grow space-y-3 min-h-0">
          <p className="text-sm text-slate-300 leading-relaxed">
            Your Gemini API key is stored only in this app on your PC (browser local
            storage). It is never sent to a Zenith server.
          </p>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Gemini API key
            </label>
            <div className="flex gap-2">
              <input
                type={showKey ? "text" : "password"}
                value={apiKeyDraft}
                onChange={(e) => setApiKeyDraft(e.target.value)}
                placeholder="Paste your API key here"
                className="flex-1 bg-slate-950/60 border border-slate-700/60 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="px-3 py-2 text-xs rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={saveKey}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium rounded-lg transition"
            >
              Save key
            </button>
            <button
              type="button"
              onClick={clearKey}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => void openUrl(API_KEY_HELP_URL)}
              className="px-4 py-2 bg-violet-700/80 hover:bg-violet-600 text-white text-xs font-medium rounded-lg transition"
            >
              Get API key
            </button>
          </div>

          {apiKeySaved && (
            <p className="text-xs text-emerald-400">API key saved on this device.</p>
          )}
          {hasKey && (
            <p className="text-xs text-slate-500">
              Current key: <span className="text-slate-300">{maskApiKey(getApiKey())}</span>
            </p>
          )}

          <div className="mt-auto p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-400 space-y-1.5 leading-relaxed">
            <p className="text-slate-300 font-medium">How to get a key</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Open Google AI Studio (button above).</li>
              <li>Sign in with your Google account.</li>
              <li>Click <strong className="text-slate-200">Create API key</strong>.</li>
              <li>Copy the key and paste it here, then Save.</li>
            </ol>
          </div>
        </div>
      ) : (
        <>
          {!hasKey && (
            <button
              type="button"
              onClick={() => void openSettings()}
              className="mt-3 text-left text-xs text-amber-200/90 bg-amber-950/40 border border-amber-700/40 rounded-xl px-3 py-2 hover:bg-amber-950/60 transition"
            >
              API key not set — click here to add it in Settings.
            </button>
          )}

          <form
            onSubmit={(e) => void handleRefactor(e)}
            className="mt-3 flex flex-col flex-grow space-y-3 min-h-0"
          >
            <div className="relative flex-grow min-h-0">
              <textarea
                ref={inputRef}
                rows={3}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleTextareaKeyDown}
                placeholder="Type rough notes (e.g., 'fixed bug server rebooted tell customer to refresh')..."
                className="w-full h-full min-h-[90px] bg-slate-950/60 border border-slate-700/60 rounded-xl p-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40 resize-none"
              />
            </div>

            <div className="flex justify-between items-center gap-2">
              <span className="text-xs text-slate-500">
                Click the floating icon to open · Ctrl+Enter to refactor
              </span>
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="shrink-0 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition shadow-lg shadow-violet-900/30"
              >
                {loading ? loadingHint || "Refactoring..." : "Refactor & Copy"}
              </button>
            </div>
          </form>

          {error && (
            <div className="mt-3 p-3 bg-red-950/60 border border-red-800/60 rounded-xl">
              <p className="text-sm text-red-200">{error}</p>
            </div>
          )}

          {output && (
            <div className="mt-3 p-3 bg-slate-950/80 border border-slate-800 rounded-xl relative overflow-auto max-h-[140px]">
              <div className="text-xs text-slate-400 mb-1 flex justify-between items-center">
                <span>
                  {copied ? "Refined Output (Copied to Clipboard!)" : "Refined Output"}
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className="text-cyan-400 hover:underline font-medium"
                >
                  {copied ? "Copied!" : "Copy Again"}
                </button>
              </div>
              <p className="text-sm text-slate-200 font-normal leading-relaxed select-text">
                {output}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
