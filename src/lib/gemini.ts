const SYSTEM_PROMPT = `You are an expert technical support engineer and developer assistant. Your task is to take the user's rough, informal draft and rewrite it into a clear, professional, polite, and grammatically correct response suitable for a client email, support ticket, or professional chat (like WhatsApp). Maintain a helpful and precise tone. Return ONLY the refined text without any conversational filler or introductory statements.`;

/** Primary first; fallbacks when a model is overloaded or unavailable. */
export const GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
] as const;

const MAX_ATTEMPTS_PER_MODEL = 3;
const RETRY_DELAYS_MS = [800, 1600, 3200];

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    message?: string;
    status?: string;
  };
}

export type RefactorProgress = {
  model: string;
  attempt: number;
  maxAttempts: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(status: number, message: string): boolean {
  const lower = message.toLowerCase();
  if (status === 429 || status === 503 || status === 500) return true;
  return (
    lower.includes("high demand") ||
    lower.includes("overloaded") ||
    lower.includes("try again") ||
    lower.includes("resource exhausted") ||
    lower.includes("unavailable")
  );
}

function isModelUnavailable(status: number, message: string): boolean {
  const lower = message.toLowerCase();
  if (status === 404) return true;
  return (
    lower.includes("no longer available") ||
    lower.includes("please update your code") ||
    lower.includes("not found") ||
    lower.includes("is not supported")
  );
}

function friendlyError(status: number, message: string): string {
  const lower = message.toLowerCase();
  if (
    lower.includes("no longer available") ||
    lower.includes("please update your code") ||
    lower.includes("not found")
  ) {
    return "That Gemini model is not available for this API key. Try again - Zenith uses the latest Flash models.";
  }
  if (lower.includes("high demand") || status === 503) {
    return "Gemini is busy right now. Zenith retried and tried backup models - wait a moment and click Refactor & Copy again.";
  }
  if (status === 429) {
    return "Rate limit hit. Wait a few seconds and try again.";
  }
  if (status === 401 || status === 403 || lower.includes("api key")) {
    return "Invalid API key. Open Settings and save a new key from Google AI Studio.";
  }
  return message || `API error (${status})`;
}

async function callGemini(
  apiKey: string,
  model: string,
  draft: string,
): Promise<{ ok: true; text: string } | { ok: false; status: number; message: string }> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: `${SYSTEM_PROMPT}\n\nDraft to refactor: ${draft}` }],
          },
        ],
      }),
    },
  );

  const data = (await response.json()) as GeminiResponse;
  const message = data.error?.message ?? "";

  if (!response.ok) {
    return { ok: false, status: response.status, message };
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) {
    return { ok: false, status: 502, message: "Empty response from Gemini." };
  }

  return { ok: true, text };
}

export async function refactorDraft(
  apiKey: string,
  draft: string,
  onProgress?: (p: RefactorProgress) => void,
): Promise<string> {
  let lastMessage = "";
  let lastStatus = 0;

  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt++) {
      onProgress?.({
        model,
        attempt: attempt + 1,
        maxAttempts: MAX_ATTEMPTS_PER_MODEL,
      });

      const result = await callGemini(apiKey, model, draft);
      if (result.ok) {
        return result.text;
      }

      lastMessage = result.message;
      lastStatus = result.status;

      if (isModelUnavailable(result.status, result.message)) {
        break;
      }

      if (isRetryable(result.status, result.message) && attempt < MAX_ATTEMPTS_PER_MODEL - 1) {
        await sleep(RETRY_DELAYS_MS[attempt] ?? 3200);
        continue;
      }

      if (!isRetryable(result.status, result.message)) {
        throw new Error(friendlyError(result.status, result.message));
      }
    }
  }

  throw new Error(friendlyError(lastStatus, lastMessage));
}
