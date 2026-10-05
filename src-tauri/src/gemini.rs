use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;
use tokio::sync::watch;

pub const DEFAULT_MODELS: &[&str] = &[
    "gemini-3.8-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
];

const MAX_ATTEMPTS: u32 = 3;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefineOptions {
    pub preset: Option<String>,
    pub custom_instruction: Option<String>,
    pub model: Option<String>,
    pub action: Option<String>,
    pub stream: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct GeminiErrorBody {
    error: Option<GeminiError>,
}

#[derive(Debug, Deserialize)]
struct GeminiError {
    message: Option<String>,
    #[allow(dead_code)]
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<Candidate>>,
    error: Option<GeminiError>,
}

#[derive(Debug, Deserialize)]
struct Candidate {
    content: Option<Content>,
}

#[derive(Debug, Deserialize)]
struct Content {
    parts: Option<Vec<Part>>,
}

#[derive(Debug, Deserialize)]
struct Part {
    text: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum RefineError {
    #[error("No API key saved. Open Settings and add your Gemini key.")]
    NoKey,
    #[error("Draft is empty.")]
    EmptyDraft,
    #[error("{0}")]
    User(String),
    #[error("Cancelled")]
    Cancelled,
}

impl RefineError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::NoKey => "NO_KEY",
            Self::EmptyDraft => "EMPTY_DRAFT",
            Self::Cancelled => "CANCELLED",
            Self::User(_) => "API_ERROR",
        }
    }
}

fn system_prompt(preset: Option<&str>, custom: Option<&str>, action: Option<&str>) -> String {
    let base = match preset.unwrap_or("support") {
        "engineering" => "You are a senior software engineer. Rewrite the draft as a clear PR description, bug report, or technical note. Preserve facts, numbers, code, URLs, and names exactly. Do not invent details. Keep the original language unless asked otherwise. Return ONLY the refined text.",
        "email" => "You are an expert at professional email. Rewrite the draft as a polished email body. Preserve facts, numbers, URLs, and names. Do not invent details. Keep the original language unless asked otherwise. Return ONLY the refined text — no subject line unless the draft already has one.",
        "slack" => "You are rewriting chat messages for Slack/Teams. Make them clear, concise, and friendly-professional. Preserve facts, numbers, URLs, and names. Do not invent details. Keep the original language unless asked otherwise. Return ONLY the refined text.",
        "casual" => "Rewrite the draft in a warm, casual, still-clear tone. Preserve facts, numbers, URLs, and names. Do not invent details. Keep the original language unless asked otherwise. Return ONLY the refined text.",
        "concise" => "Rewrite the draft to be as concise as possible while remaining polite and complete. Preserve facts, numbers, URLs, and names. Do not invent details. Keep the original language unless asked otherwise. Return ONLY the refined text.",
        _ => "You are an expert technical support engineer. Rewrite the user's rough draft into a clear, professional, polite response suitable for a client email, support ticket, or chat. Preserve facts, numbers, code, URLs, and names exactly. Do not invent details. Keep the original language unless asked otherwise. Return ONLY the refined text with no preamble.",
    };

    let mut prompt = base.to_string();
    if let Some(act) = action {
        let extra = match act {
            "shorter" => " Make the result shorter.",
            "longer" => " Add a bit more helpful detail without inventing facts.",
            "formal" => " Use a more formal tone.",
            "friendlier" => " Use a warmer, friendlier tone.",
            _ => "",
        };
        prompt.push_str(extra);
    }
    if let Some(c) = custom.map(str::trim).filter(|s| !s.is_empty()) {
        prompt.push_str("\nAdditional instructions from the user: ");
        prompt.push_str(c);
    }
    prompt
}

fn friendly(status: u16, message: &str) -> String {
    let lower = message.to_lowercase();
    if status == 0 || lower.contains("dns") || lower.contains("offline") || lower.contains("connect")
    {
        return "No internet connection.".into();
    }
    if lower.contains("timed out") || lower.contains("timeout") {
        return "Took too long — retry.".into();
    }
    if status == 401 || status == 403 || lower.contains("api key") || lower.contains("permission") {
        return "API key invalid. Open Settings and save a new key.".into();
    }
    if status == 429 {
        return "Busy — rate limited. Try again in a moment.".into();
    }
    if status == 503 || lower.contains("high demand") || lower.contains("overloaded") {
        return "Busy — try again.".into();
    }
    if status == 404
        || lower.contains("no longer available")
        || lower.contains("not found")
        || lower.contains("please update your code")
    {
        return "That Gemini model is not available for this key.".into();
    }
    if lower.contains("empty") || lower.contains("couldn") || lower.contains("blocked") {
        return "Gemini couldn't process this text.".into();
    }
    if message.is_empty() {
        format!("API error ({status})")
    } else {
        message.chars().take(180).collect()
    }
}

fn is_retryable(status: u16, message: &str) -> bool {
    let lower = message.to_lowercase();
    status == 429
        || status == 503
        || status == 500
        || lower.contains("high demand")
        || lower.contains("overloaded")
        || lower.contains("try again")
        || lower.contains("resource exhausted")
}

fn is_model_unavailable(status: u16, message: &str) -> bool {
    let lower = message.to_lowercase();
    status == 404
        || lower.contains("no longer available")
        || lower.contains("not found")
        || lower.contains("is not supported")
        || lower.contains("please update your code")
}

fn models_for(options: &RefineOptions) -> Vec<String> {
    if let Some(m) = options.model.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        let mut list = vec![m.to_string()];
        for d in DEFAULT_MODELS {
            if *d != m {
                list.push((*d).to_string());
            }
        }
        list
    } else {
        DEFAULT_MODELS.iter().map(|s| (*s).to_string()).collect()
    }
}

async fn call_once(
    client: &Client,
    api_key: &str,
    model: &str,
    prompt: &str,
    draft: &str,
) -> Result<String, (u16, String)> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    );
    let body = json!({
        "contents": [{
            "role": "user",
            "parts": [{ "text": format!("{prompt}\n\nDraft to refactor:\n{draft}") }]
        }]
    });

    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                (408, "timeout".into())
            } else if e.is_connect() {
                (0, "offline".into())
            } else {
                (0, e.to_string())
            }
        })?;

    let status = response.status().as_u16();
    let bytes = response.bytes().await.map_err(|e| (0, e.to_string()))?;
    let parsed: GeminiResponse = serde_json::from_slice(&bytes).unwrap_or(GeminiResponse {
        candidates: None,
        error: None,
    });

    if !(200..300).contains(&status) {
        let msg = parsed
            .error
            .and_then(|e| e.message)
            .or_else(|| {
                serde_json::from_slice::<GeminiErrorBody>(&bytes)
                    .ok()
                    .and_then(|b| b.error)
                    .and_then(|e| e.message)
            })
            .unwrap_or_default();
        return Err((status, msg));
    }

    let text = parsed
        .candidates
        .as_ref()
        .and_then(|c| c.first())
        .and_then(|c| c.content.as_ref())
        .and_then(|c| c.parts.as_ref())
        .and_then(|p| p.first())
        .and_then(|p| p.text.as_ref())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    match text {
        Some(t) => Ok(t),
        None => Err((502, "Gemini couldn't process this text.".into())),
    }
}

pub async fn refine_text(
    api_key: &str,
    draft: &str,
    options: RefineOptions,
    mut cancel: watch::Receiver<bool>,
    on_progress: impl Fn(String, u32, u32),
) -> Result<String, RefineError> {
    let draft = draft.trim();
    if draft.is_empty() {
        return Err(RefineError::EmptyDraft);
    }
    if api_key.trim().is_empty() {
        return Err(RefineError::NoKey);
    }

    let prompt = system_prompt(
        options.preset.as_deref(),
        options.custom_instruction.as_deref(),
        options.action.as_deref(),
    );
    let client = Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| RefineError::User(e.to_string()))?;

    let models = models_for(&options);
    let mut last_status = 0u16;
    let mut last_message = String::new();

    for model in models {
        for attempt in 0..MAX_ATTEMPTS {
            if *cancel.borrow() {
                return Err(RefineError::Cancelled);
            }
            on_progress(model.clone(), attempt + 1, MAX_ATTEMPTS);

            let result = tokio::select! {
                _ = cancel.changed() => {
                    if *cancel.borrow() {
                        return Err(RefineError::Cancelled);
                    }
                    call_once(&client, api_key, &model, &prompt, draft).await
                }
                res = call_once(&client, api_key, &model, &prompt, draft) => res,
            };

            match result {
                Ok(text) => return Ok(text),
                Err((status, message)) => {
                    last_status = status;
                    last_message = message.clone();
                    if is_model_unavailable(status, &message) {
                        break;
                    }
                    if is_retryable(status, &message) && attempt + 1 < MAX_ATTEMPTS {
                        let delay = Duration::from_millis(800 * 2u64.pow(attempt));
                        let jitter = Duration::from_millis((attempt as u64 + 1) * 120);
                        tokio::select! {
                            _ = cancel.changed() => {
                                if *cancel.borrow() {
                                    return Err(RefineError::Cancelled);
                                }
                            }
                            _ = tokio::time::sleep(delay + jitter) => {}
                        }
                        continue;
                    }
                    if !is_retryable(status, &message) {
                        return Err(RefineError::User(friendly(status, &message)));
                    }
                }
            }
        }
    }

    Err(RefineError::User(friendly(last_status, &last_message)))
}

/// Streaming refine — emits chunk callbacks, returns final text.
pub async fn refine_text_stream(
    api_key: &str,
    draft: &str,
    options: RefineOptions,
    mut cancel: watch::Receiver<bool>,
    on_progress: impl Fn(String, u32, u32),
    on_chunk: impl Fn(String),
) -> Result<String, RefineError> {
    // Prefer first model; fall back to non-stream refine on failure.
    let draft = draft.trim();
    if draft.is_empty() {
        return Err(RefineError::EmptyDraft);
    }
    if api_key.trim().is_empty() {
        return Err(RefineError::NoKey);
    }

    let prompt = system_prompt(
        options.preset.as_deref(),
        options.custom_instruction.as_deref(),
        options.action.as_deref(),
    );
    let models = models_for(&options);
    let model = models.first().cloned().unwrap_or_else(|| DEFAULT_MODELS[0].into());
    on_progress(model.clone(), 1, 1);

    let client = Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| RefineError::User(e.to_string()))?;

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse&key={api_key}"
    );
    let body = json!({
        "contents": [{
            "role": "user",
            "parts": [{ "text": format!("{prompt}\n\nDraft to refactor:\n{draft}") }]
        }]
    });

    let response = tokio::select! {
        _ = cancel.changed() => {
            if *cancel.borrow() {
                return Err(RefineError::Cancelled);
            }
            client.post(&url).json(&body).send().await
        }
        res = client.post(&url).json(&body).send() => res,
    }
    .map_err(|e| {
        if e.is_timeout() {
            RefineError::User("Took too long — retry.".into())
        } else if e.is_connect() {
            RefineError::User("No internet connection.".into())
        } else {
            RefineError::User(e.to_string())
        }
    })?;

    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        let text = response.text().await.unwrap_or_default();
        let msg = serde_json::from_str::<GeminiErrorBody>(&text)
            .ok()
            .and_then(|b| b.error)
            .and_then(|e| e.message)
            .unwrap_or(text);
        return refine_text(api_key, draft, options, cancel, |_, _, _| {}).await.map_err(|_| {
            RefineError::User(friendly(status, &msg))
        });
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut full = String::new();

    while let Some(item) = stream.next().await {
        if *cancel.borrow() {
            return Err(RefineError::Cancelled);
        }
        let chunk = item.map_err(|e| RefineError::User(e.to_string()))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim_end_matches('\r').to_string();
            buffer.drain(..=pos);
            let line = line.trim();
            if !line.starts_with("data:") {
                continue;
            }
            let data = line.trim_start_matches("data:").trim();
            if data.is_empty() || data == "[DONE]" {
                continue;
            }
            if let Ok(parsed) = serde_json::from_str::<GeminiResponse>(data) {
                if let Some(piece) = parsed
                    .candidates
                    .as_ref()
                    .and_then(|c| c.first())
                    .and_then(|c| c.content.as_ref())
                    .and_then(|c| c.parts.as_ref())
                    .and_then(|p| p.first())
                    .and_then(|p| p.text.clone())
                {
                    full.push_str(&piece);
                    on_chunk(piece);
                }
            }
        }
    }

    let trimmed = full.trim().to_string();
    if trimmed.is_empty() {
        return refine_text(api_key, draft, options, cancel, |_, _, _| {}).await;
    }
    Ok(trimmed)
}
