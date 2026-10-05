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
import {
  clearApiKey,
  hasApiKey,
  listModels,
  maskedApiKey,
  migrateLegacyApiKey,
  saveApiKey,
  testApiKey,
} from "./lib/apiKey";
import {
  cancelRefine,
  parseRefineError,
  refineText,
  type RefineAction,
  type TonePreset,
} from "./lib/gemini";
import {
  clearHistory,
  deleteHistoryItem,
  loadDraft,
  loadHistory,
  loadPrefs,
  popOutputStack,
  pushHistory,
  pushOutputStack,
  saveDraft,
  savePrefs,
  type HistoryItem,
  type ZenithPrefs,
} from "./lib/prefs";
import { persistCurrentBubblePos, placeBubble, placePanel } from "./lib/windowModes";
import { UpdateAlert, useAppUpdater } from "./lib/updater";

const API_KEY_HELP_URL = "https://aistudio.google.com/apikey";
const DRAG_EXPAND_PX = 48;

type View = "bubble" | "panel" | "settings" | "history";
type OrbState = "idle" | "hover" | "thinking" | "success" | "error" | "noKey" | "update";

const PRESETS: { id: TonePreset; label: string }[] = [
  { id: "support", label: "Support" },
  { id: "engineering", label: "Engineering" },
  { id: "email", label: "Email" },
  { id: "slack", label: "Slack" },
  { id: "casual", label: "Casual" },
  { id: "concise", label: "Concise" },
];

export default function App() {
  const [view, setView] = useState<View>("bubble");
  const [input, setInput] = useState(() => loadDraft());
  const [loading, setLoading] = useState(false);
  const [loadingHint, setLoadingHint] = useState("");
  const [output, setOutput] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [keyHint, setKeyHint] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [quitOpen, setQuitOpen] = useState(false);
  const [autostartOn, setAutostartOn] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [prefs, setPrefs] = useState<ZenithPrefs>(() => loadPrefs());
  const [models, setModels] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>(() => loadHistory());
  const [testMsg, setTestMsg] = useState("");
  const [showPrivacy, setShowPrivacy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const appWindow = getCurrentWindow();
  const pointerDownAt = useRef<{ x: number; y: number; t: number } | null>(null);
  const idleTimer = useRef<number | null>(null);
  const { state: updateState, installUpdate, dismiss: dismissUpdate } =
    useAppUpdater(true);

  const refreshKeyState = async () => {
    const exists = await hasApiKey();
    setHasKey(exists);
    setKeyHint(await maskedApiKey());
    if (!exists) setOrbState((s) => (s === "thinking" ? s : "noKey"));
  };

  useEffect(() => {
    void (async () => {
      await migrateLegacyApiKey();
      const fromEnv = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim();
      if (fromEnv && !(await hasApiKey())) {
        await saveApiKey(fromEnv);
      }
      await refreshKeyState();
      try {
        setModels(await listModels());
      } catch {
        /* ignore */
      }
      await placeBubble();
      await appWindow.show();
      await appWindow.setFocus();
      try {
        setAutostartOn(await isEnabled());
      } catch {
        /* ignore */
      }
      if (!loadPrefs().privacyAccepted) setShowPrivacy(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    savePrefs(prefs);
    document.documentElement.classList.toggle("zenith-reduce-motion", prefs.reduceMotion);
  }, [prefs]);

  useEffect(() => {
    saveDraft(input);
  }, [input]);

  useEffect(() => {
    if (hasKey && updateState.status === "available" && orbState !== "thinking") {
      setOrbState("update");
    } else if (!hasKey && orbState !== "thinking") {
      setOrbState("noKey");
    } else if (hasKey && orbState === "noKey") {
      setOrbState("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasKey, updateState.status]);

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    void listen("zenith://refocus", () => {
      flashOrb("success");
    }).then((u) => unsubs.push(u));

    void listen("zenith://tray-show", () => {
      void openFromExternal();
    }).then((u) => unsubs.push(u));

    void listen("zenith://hotkey-open", () => {
      void openFromExternal();
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

    void listen<{ model: string; attempt: number; maxAttempts: number }>(
      "zenith://refine-progress",
      (e) => {
        setLoadingHint(
          e.payload.attempt > 1
            ? `Retrying (${e.payload.attempt}/${e.payload.maxAttempts})…`
            : `Using ${e.payload.model}…`,
        );
      },
    ).then((u) => unsubs.push(u));

    void listen<{ text: string }>("zenith://refine-chunk", (e) => {
      setOutput((prev) => prev + e.payload.text);
    }).then((u) => unsubs.push(u));

    return () => unsubs.forEach((u) => u());
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

  // Slow orb after idle
  useEffect(() => {
    if (view !== "bubble" || prefs.reduceMotion) return;
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      document.documentElement.classList.add("zenith-orb-idle-slow");
    }, 30_000);
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      document.documentElement.classList.remove("zenith-orb-idle-slow");
    };
  }, [view, prefs.reduceMotion, orbState]);

  const flashOrb = (next: OrbState) => {
    setOrbState(next);
    window.setTimeout(() => {
      setOrbState(hasKey ? (updateState.status === "available" ? "update" : "idle") : "noKey");
    }, 900);
  };

  const openFromExternal = async () => {
    await appWindow.show();
    await appWindow.setFocus();
    if (view === "bubble") await openPanel();
    flashOrb("success");
  };

  const collapseToBubble = async () => {
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
    document.documentElement.classList.remove("zenith-orb-idle-slow");
    await persistCurrentBubblePos();
    setView("panel");
    await placePanel();
    await appWindow.setFocus();
    setTimeout(() => inputRef.current?.focus(), 80);
  };

  const openSettings = async () => {
    setApiKeyDraft("");
    setApiKeySaved(false);
    setTestMsg("");
    setView("settings");
    await placePanel();
    await refreshKeyState();
    await appWindow.setFocus();
    try {
      setAutostartOn(await isEnabled());
    } catch {
      /* ignore */
    }
  };

  const handleBubblePointerDown = (e: ReactPointerEvent) => {
    pointerDownAt.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    setOrbState("hover");
  };

  const handleBubblePointerUp = (e: ReactPointerEvent) => {
    const start = pointerDownAt.current;
    pointerDownAt.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 6 || Date.now() - start.t > 350) {
      setOrbState(hasKey ? "idle" : "noKey");
      return;
    }
    void openPanel();
  };

  const handleBubblePointerMove = async (e: ReactPointerEvent) => {
    const start = pointerDownAt.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 6) return;

    if (dy < -DRAG_EXPAND_PX && Math.abs(dy) > Math.abs(dx) * 1.1) {
      pointerDownAt.current = null;
      await openPanel();
      return;
    }

    pointerDownAt.current = null;
    await appWindow.startDragging();
    window.setTimeout(() => void persistCurrentBubblePos(), 400);
  };

  const updatePrefs = (patch: Partial<ZenithPrefs>) =>
    setPrefs((p) => ({ ...p, ...patch }));

  const runRefine = async (action?: RefineAction) => {
    if (!input.trim() || loading) return;
    if (!(await hasApiKey())) {
      setError("Add your Gemini API key in Settings first.");
      await openSettings();
      return;
    }

    setLoading(true);
    setLoadingHint("");
    setError("");
    setCopied(false);
    setOrbState("thinking");
    if (!action) setOutput("");
    else pushOutputStack(output);

    try {
      const text = await refineText(input, {
        preset: prefs.preset,
        customInstruction: prefs.customInstruction,
        model: prefs.model || undefined,
        action,
        stream: !action,
      });
      setOutput(text);
      setHistory(pushHistory({ draft: input, output: text, preset: prefs.preset }));
      if (prefs.autoCopy) {
        await writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }
      flashOrb("success");
    } catch (err) {
      const parsed = parseRefineError(err);
      if (parsed.code === "CANCELLED") {
        setError("");
      } else {
        setError(parsed.message);
        flashOrb("error");
        if (parsed.openSettings) await openSettings();
      }
    } finally {
      setLoading(false);
      setLoadingHint("");
    }
  };

  const handleRefactor = async (e: FormEvent) => {
    e.preventDefault();
    await runRefine();
  };

  const handleCopy = async () => {
    if (!output) return;
    await writeText(output);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleUndo = () => {
    const prev = popOutputStack();
    if (prev != null) setOutput(prev);
  };

  const handleCancel = async () => {
    await cancelRefine();
    setLoading(false);
    setLoadingHint("");
    setOrbState(hasKey ? "idle" : "noKey");
  };

  const handleTextareaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void runRefine();
    }
  };

  const saveKey = async () => {
    if (!apiKeyDraft.trim()) return;
    try {
      await saveApiKey(apiKeyDraft);
      setApiKeyDraft("");
      await refreshKeyState();
      const ok = await hasApiKey();
      if (!ok) {
        setError("Key did not save to Windows Credential Manager. Try again, or run Zenith as your user account.");
        setApiKeySaved(false);
        return;
      }
      setApiKeySaved(true);
      setError("");
      setTimeout(() => setApiKeySaved(false), 2000);
    } catch (err) {
      setApiKeySaved(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const clearKey = async () => {
    await clearApiKey();
    setApiKeyDraft("");
    await refreshKeyState();
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
      setError(err instanceof Error ? err.message : "Could not update Start with Windows.");
    } finally {
      setAutostartBusy(false);
    }
  };

  const wordCount = input.trim() ? input.trim().split(/\s+/).length : 0;

  if (view === "bubble") {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-transparent">
        <button
          type="button"
          aria-label="Open Zenith AI Assistant. Drag up to expand. Right-click to quit."
          title="Click or drag up to open · Right-click to quit · Ctrl+Alt+Space"
          onPointerDown={handleBubblePointerDown}
          onPointerMove={(e) => void handleBubblePointerMove(e)}
          onPointerUp={handleBubblePointerUp}
          onPointerLeave={() => {
            if (!pointerDownAt.current && orbState === "hover") {
              setOrbState(hasKey ? "idle" : "noKey");
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            void (async () => {
              await placePanel();
              setView("panel");
              setQuitOpen(true);
            })();
          }}
          className={`zenith-bubble h-[64px] w-[64px] rounded-full flex items-center justify-center cursor-pointer overflow-visible bg-transparent border-0 outline-none p-0 zenith-bubble--${orbState}`}
        >
          <span className="zenith-bubble__lift block h-full w-full rounded-full overflow-hidden">
            <ZenithMark variant="orb" className="h-full w-full rounded-full pointer-events-none" />
          </span>
          {(orbState === "noKey" || !hasKey) && (
            <span className="zenith-bubble__dot zenith-bubble__dot--warn" />
          )}
          {hasKey && updateState.status === "available" && (
            <span className="zenith-bubble__dot zenith-bubble__dot--update" />
          )}
        </button>
      </div>
    );
  }

  const headerSubtitle =
    view === "settings" ? "Settings" : view === "history" ? "History" : "AI Assistant";

  return (
    <div className="zenith-panel zenith-panel--enter">
      <PanelHeader
        subtitle={headerSubtitle}
        orbState={
          orbState === "thinking" || orbState === "success" || orbState === "error"
            ? orbState
            : "idle"
        }
        onMinimize={() => void collapseToBubble()}
        onQuit={requestQuit}
        onCollapseDrag={() => void collapseToBubble()}
        onSettings={view === "panel" ? () => void openSettings() : undefined}
        onBack={
          view === "settings" || view === "history" ? () => setView("panel") : undefined
        }
      />

      <div className="zenith-panel__body">
        <UpdateAlert
          state={updateState}
          onUpdate={() => void installUpdate()}
          onDismiss={dismissUpdate}
        />

        {showPrivacy && (
          <div className="zenith-card text-[0.75rem] text-slate-300 space-y-2" role="dialog">
            <p className="text-slate-100 font-semibold">Before you start</p>
            <p>
              Your draft text is sent to <strong className="text-white">Google Gemini</strong> using
              your API key. The key is stored in Windows Credential Manager on this PC only.
            </p>
            <button
              type="button"
              className="zenith-btn zenith-btn--primary"
              onClick={() => {
                updatePrefs({ privacyAccepted: true, onboardingDone: true });
                setShowPrivacy(false);
              }}
            >
              Got it
            </button>
          </div>
        )}

        {!prefs.onboardingDone && !showPrivacy && view === "panel" && (
          <div className="zenith-banner zenith-banner--warn text-left">
            <strong>First run:</strong> save a Gemini key in Settings → paste a draft → Refactor
            &amp; Copy.{" "}
            <button type="button" className="underline" onClick={() => void openSettings()}>
              Open Settings
            </button>
          </div>
        )}

        {error && (
          <div className="zenith-toast zenith-toast--error" role="alert" aria-live="assertive">
            <span className="zenith-toast__text">{error}</span>
            <button type="button" className="zenith-toast__dismiss" onClick={() => setError("")}>
              Dismiss
            </button>
          </div>
        )}

        {copied && (
          <div className="zenith-toast zenith-toast--ok" role="status" aria-live="polite">
            Copied ✓
          </div>
        )}

        {view === "settings" ? (
          <div className="flex flex-col gap-2.5 pb-1">
            <p className="text-[0.75rem] text-slate-300/90 leading-relaxed">
              Your Gemini API key is stored in Windows Credential Manager. Zenith never returns the
              full key to the UI after save.
            </p>

            <div>
              <label className="zenith-label" htmlFor="api-key">
                Gemini API key
              </label>
              <div className="flex gap-2">
                <input
                  id="api-key"
                  type="password"
                  value={apiKeyDraft}
                  onChange={(e) => setApiKeyDraft(e.target.value)}
                  placeholder={hasKey ? "Enter a new key to replace" : "Paste your API key"}
                  className="zenith-input"
                  autoComplete="off"
                />
              </div>
              {keyHint && (
                <p className="text-[0.6875rem] text-slate-500 mt-1">
                  Saved: <span className="text-slate-300 font-mono">{keyHint}</span>
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void saveKey()}
                disabled={!apiKeyDraft.trim()}
                className="zenith-btn zenith-btn--primary"
              >
                Save key
              </button>
              <button type="button" onClick={() => void clearKey()} className="zenith-btn zenith-btn--secondary">
                Clear
              </button>
              <button
                type="button"
                onClick={() => void openUrl(API_KEY_HELP_URL)}
                className="zenith-btn zenith-btn--ghost"
              >
                Get API key
              </button>
              <button
                type="button"
                className="zenith-btn zenith-btn--ghost"
                onClick={() =>
                  void testApiKey()
                    .then((m) => setTestMsg(m))
                    .catch((e) => setTestMsg(String(e)))
                }
              >
                Test key
              </button>
            </div>
            {apiKeySaved && <p className="text-xs text-emerald-300">API key saved securely.</p>}
            {testMsg && <p className="text-xs text-slate-400">{testMsg}</p>}

            <div>
              <label className="zenith-label" htmlFor="model">
                Preferred model
              </label>
              <select
                id="model"
                className="zenith-input w-full"
                value={prefs.model}
                onChange={(e) => updatePrefs({ model: e.target.value })}
              >
                <option value="">Auto (fallback chain)</option>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="zenith-label" htmlFor="custom-instr">
                Custom instruction
              </label>
              <input
                id="custom-instr"
                className="zenith-input w-full"
                value={prefs.customInstruction}
                onChange={(e) => updatePrefs({ customInstruction: e.target.value })}
                placeholder="e.g. Always sign off as Nishant"
              />
            </div>

            <label className="zenith-card flex items-center justify-between gap-3 cursor-pointer">
              <span>
                <span className="text-slate-200 font-semibold text-[0.8125rem] block">Auto-copy</span>
                <span className="text-[0.75rem] text-slate-400">Copy refined text automatically</span>
              </span>
              <input
                type="checkbox"
                checked={prefs.autoCopy}
                onChange={(e) => updatePrefs({ autoCopy: e.target.checked })}
              />
            </label>

            <label className="zenith-card flex items-center justify-between gap-3 cursor-pointer">
              <span>
                <span className="text-slate-200 font-semibold text-[0.8125rem] block">
                  Reduce animations
                </span>
                <span className="text-[0.75rem] text-slate-400">Also respects system reduced motion</span>
              </span>
              <input
                type="checkbox"
                checked={prefs.reduceMotion}
                onChange={(e) => updatePrefs({ reduceMotion: e.target.checked })}
              />
            </label>

            <div className="zenith-card flex items-center justify-between gap-3">
              <div>
                <p className="text-slate-200 font-semibold text-[0.8125rem]">Start with Windows</p>
                <p className="text-[0.75rem] text-slate-400 mt-0.5">Launch orb at sign-in</p>
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

            <p className="text-[0.6875rem] text-slate-500">
              Global hotkey: <span className="zenith-kbd">Ctrl</span> +{" "}
              <span className="zenith-kbd">Alt</span> + <span className="zenith-kbd">Space</span> ·
              Version 0.1.x · Updates via GitHub Releases
            </p>

            <div className="zenith-card text-[0.75rem] text-slate-400 space-y-1.5">
              <p className="text-slate-200 font-semibold text-[0.8125rem]">How to get a key</p>
              <ol className="list-decimal list-inside space-y-1 marker:text-violet-400/80">
                <li>Open Google AI Studio.</li>
                <li>Create API key → copy → Save above.</li>
              </ol>
            </div>
          </div>
        ) : view === "history" ? (
          <div className="flex flex-col gap-2 min-h-0">
            <div className="flex justify-between items-center">
              <p className="text-[0.75rem] text-slate-400">Stored on this device only (last 40).</p>
              <button type="button" className="zenith-btn zenith-btn--ghost" onClick={() => {
                clearHistory();
                setHistory([]);
              }}>
                Clear all
              </button>
            </div>
            <div className="flex flex-col gap-2 overflow-auto min-h-0">
              {history.length === 0 && (
                <p className="text-sm text-slate-500">No history yet.</p>
              )}
              {history.map((h) => (
                <div key={h.id} className="zenith-card text-[0.75rem]">
                  <div className="flex justify-between gap-2 mb-1">
                    <span className="text-violet-300/90 uppercase tracking-wide text-[0.625rem]">
                      {h.preset} · {new Date(h.at).toLocaleString()}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="text-violet-400 font-semibold"
                        onClick={() => void writeText(h.output)}
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        className="text-slate-400"
                        onClick={() => setHistory(deleteHistoryItem(h.id))}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <p className="text-slate-300 line-clamp-3 whitespace-pre-wrap">{h.output}</p>
                </div>
              ))}
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

            <div className="flex flex-wrap gap-1.5 shrink-0">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`zenith-chip ${prefs.preset === p.id ? "zenith-chip--on" : ""}`}
                  onClick={() => updatePrefs({ preset: p.id })}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                className="zenith-chip"
                onClick={() => setView("history")}
              >
                History
              </button>
            </div>

            <form
              onSubmit={(e) => void handleRefactor(e)}
              className="zenith-split flex-grow min-h-0"
            >
              <section className="zenith-split__col">
                <div className="flex justify-between items-center">
                  <div className="zenith-split__label">Draft</div>
                  <span className="text-[0.625rem] text-slate-500">
                    {wordCount} words · {input.length} chars
                  </span>
                </div>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleTextareaKeyDown}
                  placeholder="Rough notes… e.g. fixed bug, server rebooted, tell customer to refresh"
                  className="zenith-field flex-grow min-h-0"
                  aria-label="Draft text"
                />
                <div className="flex items-center justify-between gap-3 shrink-0 pt-1">
                  <p className="text-[0.6875rem] text-slate-500 leading-snug">
                    <span className="zenith-kbd">Ctrl</span> +{" "}
                    <span className="zenith-kbd">Enter</span>
                  </p>
                  {loading ? (
                    <button
                      type="button"
                      onClick={() => void handleCancel()}
                      className="zenith-btn zenith-btn--secondary px-4 py-2.5 text-xs"
                    >
                      Cancel
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={!input.trim()}
                      className="zenith-btn zenith-btn--primary px-4 py-2.5 text-xs shrink-0"
                    >
                      Refactor & Copy
                    </button>
                  )}
                </div>
              </section>

              <section className="zenith-split__col">
                <div className="flex items-center justify-between gap-2">
                  <div className="zenith-split__label">
                    {loading ? loadingHint || "Refining…" : "Refined"}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleUndo}
                      className="text-[0.6875rem] font-semibold text-slate-400 hover:text-slate-200"
                    >
                      Undo
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopy()}
                      disabled={!output}
                      className="text-[0.6875rem] font-semibold text-violet-400 hover:text-violet-300 disabled:opacity-40"
                    >
                      Copy
                    </button>
                  </div>
                </div>
                <div className="zenith-card zenith-output-pane flex-grow min-h-0" aria-live="polite">
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
                {output && !loading && (
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ["regenerate", "Regenerate"],
                        ["shorter", "Shorter"],
                        ["longer", "Longer"],
                        ["formal", "More formal"],
                        ["friendlier", "Friendlier"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className="zenith-chip"
                        onClick={() => void runRefine(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
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
