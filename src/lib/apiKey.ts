import { invoke } from "@tauri-apps/api/core";

const LEGACY_STORAGE_KEY = "zenith.geminiApiKey";

/** Migrate plaintext localStorage key into OS credential store, then delete it. */
export async function migrateLegacyApiKey(): Promise<void> {
  try {
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)?.trim();
    if (!legacy) return;
    const already = await hasApiKey();
    if (!already) {
      await saveApiKey(legacy);
    }
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignore migration failures */
  }
}

export async function saveApiKey(key: string): Promise<void> {
  await invoke("save_api_key", { key });
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export async function hasApiKey(): Promise<boolean> {
  return invoke<boolean>("has_api_key");
}

export async function clearApiKey(): Promise<void> {
  await invoke("clear_api_key");
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export async function maskedApiKey(): Promise<string | null> {
  return invoke<string | null>("masked_api_key");
}

export async function listModels(): Promise<string[]> {
  return invoke<string[]>("list_models");
}

export async function testApiKey(): Promise<string> {
  return invoke<string>("test_api_key");
}
