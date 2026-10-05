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
import { exit } from "@tauri-apps/plugin-process";
import { ZenithMark } from "./brand/ZenithMark";
import { PanelHeader } from "./components/PanelHeader";
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

  const quitApp = async () => {
    await exit(0);
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
      await placePanel();
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
          p.attempt > 1 ? `Retrying (${p.attempt}/${p.maxAttempts})…` : "",
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
          aria-label="Open Zenith AI Assistant. Right-click to quit."
          title="Click to open · Right-click to quit"
          onPointerDown={handleBubblePointerDown}
          onPointerMove={(e) => void handleBubblePointerMove(e)}
          onPointerUp={handleBubblePointerUp}
          onContextMenu={(e) => {
            e.preventDefault();
            void quitApp();
          }}
          className="zenith-bubble h-[64px] w-[64px] rounded-[22%] flex items-center justify-center cursor-pointer overflow-visible bg-transparent border-0 outline-none p-0"
        >
          <span className="zenith-bubble__lift block h-full w-full rounded-[22%] overflow-hidden">
            <ZenithMark className="h-full w-full rounded-[22%] pointer-events-none" />
          </span>
          {!hasKey && <span className="zenith-bubble__dot zenith-bubble__dot--warn" />}
          {hasKey && updateState.status === "available" && (
            <span className="zenith-bubble__dot zenith-bubble__dot--update" />
          )}
        </button>
      </div>
    );
  }

  const headerSubtitle =
    view === "settings" ? "Settings" : "AI Assistant";

  return (
    <div className="zenith-panel">
      <PanelHeader
        subtitle={headerSubtitle}
        onMinimize={() => void collapseToBubble()}
        onQuit={() => void quitApp()}
        onSettings={view === "panel" ? () => void openSettings() : undefined}
        onBack={view === "settings" ? () => setView("panel") : undefined}
      />

      <div className="zenith-panel__body">
        <UpdateAlert
          state={updateState}
          onUpdate={() => void installUpdate()}
          onDismiss={dismissUpdate}
        />

        {view === "settings" ? (
          <div className="flex flex-col gap-2.5 pb-1">
            <p className="text-[0.75rem] text-slate-300/90 leading-relaxed">
              Your Gemini API key stays on this device only. Zenith never sends it to
              our servers.
            </p>

            <div>
              <label className="zenith-label" htmlFor="api-key">
                Gemini API key
              </label>
              <div className="flex gap-2">
                <input
                  id="api-key"
                  type={showKey ? "text" : "password"}
                  value={apiKeyDraft}
                  onChange={(e) => setApiKeyDraft(e.target.value)}
                  placeholder="Paste your API key"
                  className="zenith-input"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="zenith-btn zenith-btn--secondary shrink-0"
                >
                  {showKey ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={saveKey} className="zenith-btn zenith-btn--primary">
                Save key
              </button>
              <button type="button" onClick={clearKey} className="zenith-btn zenith-btn--secondary">
                Clear
              </button>
              <button
                type="button"
                onClick={() => void openUrl(API_KEY_HELP_URL)}
                className="zenith-btn zenith-btn--ghost"
              >
                Get API key
              </button>
            </div>

            {apiKeySaved && (
              <p className="zenith-banner zenith-banner--success text-xs px-0 py-0 border-0 bg-transparent">
                API key saved on this device.
              </p>
            )}
            {hasKey && (
              <p className="text-[0.6875rem] text-slate-500">
                Stored key:{" "}
                <span className="text-slate-300 font-mono">{maskApiKey(getApiKey())}</span>
              </p>
            )}

            <div className="zenith-card text-[0.75rem] text-slate-400 space-y-1.5 leading-relaxed">
              <p className="text-slate-200 font-semibold text-[0.8125rem]">How to get a key</p>
              <ol className="list-decimal list-inside space-y-1 marker:text-violet-400/80">
                <li>Open Google AI Studio (button above).</li>
                <li>Sign in with your Google account.</li>
                <li>
                  Click <strong className="text-slate-200">Create API key</strong>.
                </li>
                <li>Copy the key, paste here, then Save.</li>
              </ol>
            </div>
          </div>
        ) : (
          <>
            {!hasKey && (
              <button
                type="button"
                onClick={() => void openSettings()}
                className="zenith-banner zenith-banner--warn w-full text-left hover:brightness-110 transition"
              >
                API key required — open Settings to add your Gemini key.
              </button>
            )}

            <form
              onSubmit={(e) => void handleRefactor(e)}
              className="flex flex-col flex-grow gap-3 min-h-0"
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleTextareaKeyDown}
                placeholder="Rough notes… e.g. fixed bug, server rebooted, tell customer to refresh"
                className="zenith-field flex-grow min-h-[120px]"
              />

              <div className="flex items-end justify-between gap-3 shrink-0">
                <p className="text-[0.6875rem] text-slate-500 leading-snug max-w-[14rem]">
                  <span className="zenith-kbd">Ctrl</span> +{" "}
                  <span className="zenith-kbd">Enter</span> to refactor
                </p>
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  className="zenith-btn zenith-btn--primary px-5 py-2.5 text-xs shrink-0"
                >
                  {loading ? (
                    <>
                      <span className="zenith-btn__spinner" aria-hidden />
                      {loadingHint || "Refactoring…"}
                    </>
                  ) : (
                    "Refactor & Copy"
                  )}
                </button>
              </div>
            </form>

            {error && (
              <div className="zenith-banner zenith-banner--error" role="alert">
                {error}
              </div>
            )}

            {output && (
              <div className="zenith-card zenith-output">
                <div className="flex justify-between items-center gap-2 mb-2">
                  <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-violet-300/90">
                    {copied ? "Copied to clipboard" : "Refined output"}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopy()}
                    className="text-[0.6875rem] font-semibold text-violet-400 hover:text-violet-300"
                  >
                    {copied ? "Copied!" : "Copy again"}
                  </button>
                </div>
                <p className="zenith-output__text">{output}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
