use crate::credentials;
use crate::gemini::{self, RefineOptions};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::watch;

pub struct RefineGate {
    pub cancel_tx: Mutex<Option<watch::Sender<bool>>>,
}

impl Default for RefineGate {
    fn default() -> Self {
        Self {
            cancel_tx: Mutex::new(None),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    model: String,
    attempt: u32,
    max_attempts: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChunkPayload {
    text: String,
}

#[tauri::command]
pub fn save_api_key(key: String) -> Result<(), String> {
    credentials::save_api_key(&key)
}

#[tauri::command]
pub fn has_api_key() -> Result<bool, String> {
    credentials::has_api_key()
}

#[tauri::command]
pub fn clear_api_key() -> Result<(), String> {
    credentials::clear_api_key()
}

#[tauri::command]
pub fn masked_api_key() -> Result<Option<String>, String> {
    credentials::mask_api_key_hint()
}

#[tauri::command]
pub fn list_models() -> Vec<&'static str> {
    gemini::DEFAULT_MODELS.to_vec()
}

#[tauri::command]
pub async fn refine_text(
    app: AppHandle,
    gate: State<'_, RefineGate>,
    draft: String,
    options: RefineOptions,
) -> Result<String, String> {
    let api_key = credentials::load_api_key()?
        .ok_or_else(|| gemini::RefineError::NoKey.to_string())?;

    let (tx, rx) = watch::channel(false);
    {
        let mut slot = gate.cancel_tx.lock().map_err(|e| e.to_string())?;
        *slot = Some(tx);
    }

    let app_progress = app.clone();
    let want_stream = options.stream.unwrap_or(true);

    let result = if want_stream {
        let app_chunk = app.clone();
        gemini::refine_text_stream(
            &api_key,
            &draft,
            options,
            rx,
            move |model, attempt, max_attempts| {
                let _ = app_progress.emit(
                    "zenith://refine-progress",
                    ProgressPayload {
                        model,
                        attempt,
                        max_attempts,
                    },
                );
            },
            move |text| {
                let _ = app_chunk.emit("zenith://refine-chunk", ChunkPayload { text });
            },
        )
        .await
    } else {
        gemini::refine_text(
            &api_key,
            &draft,
            options,
            rx,
            move |model, attempt, max_attempts| {
                let _ = app_progress.emit(
                    "zenith://refine-progress",
                    ProgressPayload {
                        model,
                        attempt,
                        max_attempts,
                    },
                );
            },
        )
        .await
    };

    {
        if let Ok(mut slot) = gate.cancel_tx.lock() {
            *slot = None;
        }
    }

    result.map_err(|e| {
        let msg = e.to_string();
        // Attach a stable code prefix for the UI when useful
        match e.code() {
            "NO_KEY" | "EMPTY_DRAFT" | "CANCELLED" => format!("{}:{msg}", e.code()),
            _ => msg,
        }
    })
}

#[tauri::command]
pub fn cancel_refine(gate: State<'_, RefineGate>) -> Result<(), String> {
    if let Ok(slot) = gate.cancel_tx.lock() {
        if let Some(tx) = slot.as_ref() {
            let _ = tx.send(true);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn test_api_key() -> Result<String, String> {
    let key = credentials::load_api_key()?.ok_or("NO_KEY:No API key saved.")?;
    // Lightweight validation: key shape only; real call happens on refine.
    if key.len() < 20 {
        return Err("API key invalid. Open Settings and save a new key.".into());
    }
    Ok("Key is saved in Windows Credential Manager.".into())
}
