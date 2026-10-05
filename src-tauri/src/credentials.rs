use keyring::{Entry, Error as KeyringError};

const SERVICE: &str = "com.zenith.assistant";
const USER: &str = "gemini_api_key";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, USER).map_err(|e| e.to_string())
}

pub fn save_api_key(key: &str) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return clear_api_key();
    }
    entry()?
        .set_password(trimmed)
        .map_err(|e| e.to_string())
}

pub fn has_api_key() -> Result<bool, String> {
    match entry()?.get_password() {
        Ok(p) => Ok(!p.trim().is_empty()),
        Err(KeyringError::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

pub fn clear_api_key() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Internal only — never expose to the frontend.
pub fn load_api_key() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(p) => {
            let t = p.trim().to_string();
            Ok(if t.is_empty() { None } else { Some(t) })
        }
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn mask_api_key_hint() -> Result<Option<String>, String> {
    match load_api_key()? {
        None => Ok(None),
        Some(key) => {
            if key.len() <= 8 {
                Ok(Some("••••••••".into()))
            } else {
                Ok(Some(format!("{}…{}", &key[..4], &key[key.len() - 4..])))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn mask_shape() {
        let key = "ABCDEFGHIJKLMNOP";
        let hint = format!("{}…{}", &key[..4], &key[key.len() - 4..]);
        assert_eq!(hint, "ABCD…MNOP");
    }
}
