import { invoke } from "@tauri-apps/api/core";

export type TonePreset =
  | "support"
  | "engineering"
  | "email"
  | "slack"
  | "casual"
  | "concise";

export type RefineAction = "shorter" | "longer" | "formal" | "friendlier" | "regenerate";

export type RefineOptions = {
  preset?: TonePreset;
  customInstruction?: string;
  model?: string;
  action?: RefineAction | string;
  stream?: boolean;
};

export type RefactorProgress = {
  model: string;
  attempt: number;
  maxAttempts: number;
};

export async function refineText(
  draft: string,
  options: RefineOptions = {},
): Promise<string> {
  return invoke<string>("refine_text", {
    draft,
    options: {
      preset: options.preset ?? "support",
      customInstruction: options.customInstruction ?? null,
      model: options.model ?? null,
      action: options.action ?? null,
      stream: options.stream ?? true,
    },
  });
}

export async function cancelRefine(): Promise<void> {
  await invoke("cancel_refine");
}

export function parseRefineError(err: unknown): {
  message: string;
  code?: string;
  openSettings?: boolean;
} {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.startsWith("NO_KEY:")) {
    return { message: raw.slice(7), code: "NO_KEY", openSettings: true };
  }
  if (raw.startsWith("CANCELLED:")) {
    return { message: "Cancelled.", code: "CANCELLED" };
  }
  if (raw.startsWith("EMPTY_DRAFT:")) {
    return { message: "Draft is empty.", code: "EMPTY_DRAFT" };
  }
  if (/api key invalid/i.test(raw)) {
    return { message: raw, openSettings: true };
  }
  return { message: raw };
}
