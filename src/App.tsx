import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { openUrl } from "@tauri-apps/plugin-opener";
import { exit } from "@tauri-apps/plugin-process";
import { ZenithMark } from "./brand/ZenithMark";
import { PanelHeader } from "./components/PanelHeader";
import { QuitConfirm } from "./components/QuitConfirm";
import { getApiKey, maskApiKey, setApiKey } from "./lib/apiKey";
import { persistCurrentBubblePos, placeBubble, placePanel } from "./lib/windowModes";
import { refactorDraft } from "./lib/gemini";
import { UpdateAlert, useAppUpdater } from "./lib/updater";

const API_KEY_HELP_URL = "https://aistudio.google.com/apikey";
const DRAG_EXPAND_PX = 48;

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
  const [quitOpen, setQuitOpen] = useState(false);
  const [autostartOn, setAutostartOn] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [bubblePulse, setBubblePulse] = useState(false);
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
      try {
        setAutostartOn(await isEnabled());
      } catch {
        /* autostart unavailable in some envs */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    void listen("zenith://refocus", () => {
      setBubblePulse(true);
      window.setTimeout(() => setBubblePulse(false), 1200);
    }).then((u) => unsubs.push(u));

    void listen("zenith://tray-show", () => {
      void (async () => {
        if (view === "bubble") {
          await placeBubble();
        }
        await appWindow.show();
        await appWindow.setFocus();
        setBubblePulse(true);
        window.setTimeout(() => setBubblePulse(false), 1200);
      })();
    }).then((u) => unsubs.push(u));

    void listen("zenith://tray-quit", () => {
      setQuitOpen(true);
      void (async () => {
        if (view === "bubble") {
          await placePanel();
          setView("panel");
        }
        await appWindow.show();
        await appWindow.setFocus();
      })();
    }).then((u) => unsubs.push(u));

    return () => {
      unsubs.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (quitOpen) {
          e.preventDefault();
          setQuitOpen(false);
          return;
        }
        if (view !== "bubble") {
          e.preventDefault();
          void collapseToBubble();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, quitOpen]);

  const collapseToBubble = async () => {
    setInput("");
    setOutput("");
    setCopied(false);
    setError("");
    setQuitOpen(false);
    setView("bubble");
    await placeBubble();
  };

  const requestQuit = () => setQuitOpen(true);

  const confirmQuit = async () => {
    setQuitOpen(false);
    await exit(0);
  };

  const openPanel = async () => {
    await persistCurrentBubblePos();
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
    try {
      setAutostartOn(await isEnabled());
    } catch {
      /* ignore */
    }
  };

  const handleBubblePointerDown = (e: ReactPointerEvent) => {
    pointerDownAt.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  };

  const handleBubblePointerUp = (e: ReactPointerEvent) => {
    const start = pointerDownAt.current;
    pointerDownAt.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 6 || Date.now() - start.t > 350) return;
    void openPanel();
  };

  const handleBubblePointerMove = async (e: ReactPointerEvent) => {
    const start = pointerDownAt.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 6) return;

    // Drag mostly upward → expand to panel
    if (dy < -DRAG_EXPAND_PX && Math.abs(dy) > Math.abs(dx) * 1.1) {
      pointerDownAt.current = null;
      await openPanel();
      return;
    }

    pointerDownAt.current = null;
    await appWindow.startDragging();
    // Persist position after OS drag ends (best-effort)
    window.setTimeout(() => {
      void persistCurrentBubblePos();
    }, 400);
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

  const toggleAutostart = async () => {
    setAutostartBusy(true);
    try {
      if (autostartOn) {
        await disable();
        setAutostartOn(false);
      } else {
        await enable();
        setAutostartOn(true);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update Start with Windows.",
      );
    } finally {
      setAutostartBusy(false);
    }
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
          aria-label="Open Zenith AI Assistant. Drag up to expand. Right-click to quit."
          title="Click or drag up to open · Right-click to quit"
          onPointerDown={handleBubblePointerDown}
          onPointerMove={(e) => void handleBubblePointerMove(e)}
          onPointerUp={handleBubblePointerUp}
          onContextMenu={(e) => {
            e.preventDefault();
            void (async () => {
              await placePanel();
              setView("panel");
              setQuitOpen(true);
            })();
          }}
          className={`zenith-bubble h-[64px] w-[64px] rounded-full flex items-center justify-center cursor-pointer overflow-visible bg-transparent border-0 outline-none p-0 ${bubblePulse ? "zenith-bubble--pulse" : ""}`}
        >
          <span className="zenith-bubble__lift block h-full w-full rounded-full overflow-hidden">
            <ZenithMark
              variant="orb"
              className="h-full w-full rounded-full pointer-events-none"
            />
          </span>
          {!hasKey && <span className="zenith-bubble__dot zenith-bubble__dot--warn" />}
          {hasKey && updateState.status === "available" && (
            <span className="zenith-bubble__dot zenith-bubble__dot--update" />
          )}
        </button>
      </div>
    );
  }

  const headerSubtitle = view === "settings" ? "Settings" : "AI Assistant";

  return (
    <div className="zenith-panel">
      <PanelHeader
        subtitle={headerSubtitle}
        onMinimize={() => void collapseToBubble()}
        onQuit={requestQuit}
        onCollapseDrag={() => void collapseToBubble()}
        onSettings={view === "panel" ? () => void openSettings() : undefined}
        onBack={view === "settings" ? () => setView("panel") : undefined}
      />

      <div className="zenith-panel__body">
        <UpdateAlert
          state={updateState}
          onUpdate={() => void installUpdate()}
          onDismiss={dismissUpdate}
        />

        {error && (
          <div className="zenith-toast zenith-toast--error" role="alert">
            <span className="zenith-toast__text">{error}</span>
            <button
              type="button"
              className="zenith-toast__dismiss"
              onClick={() => setError("")}
              aria-label="Dismiss error"
            >
              Dismiss
            </button>
          </div>
        )}

        {view === "settings" ? (
          <div className="flex flex-col gap-2.5 pb-1">
            <p className="text-[0.75rem] text-slate-300/90 leading-relaxed">
              Your Gemini API key stays on this device only. Zenith never sends it to our servers.
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
              <p className="text-xs text-emerald-300">API key saved on this device.</p>
            )}
            {hasKey && (
              <p className="text-[0.6875rem] text-slate-500">
                Stored key:{" "}
                <span className="text-slate-300 font-mono">{maskApiKey(getApiKey())}</span>
              </p>
            )}

            <div className="zenith-card flex items-center justify-between gap-3">
              <div>
                <p className="text-slate-200 font-semibold text-[0.8125rem]">Start with Windows</p>
                <p className="text-[0.75rem] text-slate-400 mt-0.5">
                  Launch the floating bubble when you sign in.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autostartOn}
                disabled={autostartBusy}
                onClick={() => void toggleAutostart()}
                className={`zenith-switch ${autostartOn ? "zenith-switch--on" : ""}`}
              >
                <span className="zenith-switch__thumb" />
              </button>
            </div>

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
              className="zenith-split flex-grow min-h-0"
            >
              <section className="zenith-split__col">
                <div className="zenith-split__label">Draft</div>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleTextareaKeyDown}
                  placeholder="Rough notes… e.g. fixed bug, server rebooted, tell customer to refresh"
                  className="zenith-field flex-grow min-h-0"
                />
                <div className="flex items-center justify-between gap-3 shrink-0 pt-1">
                  <p className="text-[0.6875rem] text-slate-500 leading-snug">
                    <span className="zenith-kbd">Ctrl</span> +{" "}
                    <span className="zenith-kbd">Enter</span>
                  </p>
                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    className="zenith-btn zenith-btn--primary px-4 py-2.5 text-xs shrink-0"
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
              </section>

              <section className="zenith-split__col">
                <div className="flex items-center justify-between gap-2">
                  <div className="zenith-split__label">
                    {copied ? "Copied to clipboard" : "Refined"}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopy()}
                    disabled={!output}
                    className="text-[0.6875rem] font-semibold text-violet-400 hover:text-violet-300 disabled:opacity-40 disabled:pointer-events-none"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <div className="zenith-card zenith-output-pane flex-grow min-h-0">
                  {loading && !output ? (
                    <div className="zenith-output-pane__empty">
                      <span className="zenith-btn__spinner" aria-hidden />
                      <span>{loadingHint || "Refactoring…"}</span>
                    </div>
                  ) : output ? (
                    <p className="zenith-output__text">{output}</p>
                  ) : (
                    <div className="zenith-output-pane__empty">
                      Refined reply appears here
                    </div>
                  )}
                </div>
              </section>
            </form>
          </>
        )}
      </div>

      <QuitConfirm
        open={quitOpen}
        onCancel={() => setQuitOpen(false)}
        onConfirm={() => void confirmQuit()}
      />
    </div>
  );
}
