export type TonePreset =
  | "support"
  | "engineering"
  | "email"
  | "slack"
  | "casual"
  | "concise";

export type ZenithPrefs = {
  preset: TonePreset;
  customInstruction: string;
  model: string;
  autoCopy: boolean;
  reduceMotion: boolean;
  hotkeyEnabled: boolean;
  privacyAccepted: boolean;
  onboardingDone: boolean;
};

const PREFS_KEY = "zenith.prefs";
const DRAFT_KEY = "zenith.draft";
const HISTORY_KEY = "zenith.history";
const OUTPUT_STACK_KEY = "zenith.outputStack";

export const DEFAULT_PREFS: ZenithPrefs = {
  preset: "support",
  customInstruction: "",
  model: "",
  autoCopy: true,
  reduceMotion: false,
  hotkeyEnabled: true,
  privacyAccepted: false,
  onboardingDone: false,
};

export function loadPrefs(): ZenithPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<ZenithPrefs>) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: ZenithPrefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveDraft(draft: string) {
  localStorage.setItem(DRAFT_KEY, draft);
}

export type HistoryItem = {
  id: string;
  draft: string;
  output: string;
  preset: string;
  at: number;
};

export function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HistoryItem[];
  } catch {
    return [];
  }
}

export function pushHistory(item: Omit<HistoryItem, "id" | "at">) {
  const next: HistoryItem = {
    ...item,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
  };
  const list = [next, ...loadHistory()].slice(0, 40);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  return list;
}

export function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
}

export function deleteHistoryItem(id: string) {
  const list = loadHistory().filter((h) => h.id !== id);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  return list;
}

export function pushOutputStack(text: string) {
  try {
    const raw = localStorage.getItem(OUTPUT_STACK_KEY);
    const stack: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    stack.push(text);
    localStorage.setItem(OUTPUT_STACK_KEY, JSON.stringify(stack.slice(-20)));
  } catch {
    /* ignore */
  }
}

export function popOutputStack(): string | null {
  try {
    const raw = localStorage.getItem(OUTPUT_STACK_KEY);
    const stack: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    const last = stack.pop() ?? null;
    localStorage.setItem(OUTPUT_STACK_KEY, JSON.stringify(stack));
    return last;
  } catch {
    return null;
  }
}
