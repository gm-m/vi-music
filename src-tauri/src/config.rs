// App configuration: default folder, keybindings, settings and custom theme

use serde::{Deserialize, Serialize};

use crate::storage::{config_path, read_json, read_text, write_json, write_text};

const CONFIG_FILE: &str = "config.json";
const KEYBINDINGS_FILE: &str = "keybindings.json";
const SETTINGS_FILE: &str = "settings.json";
const THEME_FILE: &str = "theme.json";

#[derive(Serialize, Deserialize, Default)]
struct AppConfig {
    default_folder: Option<String>,
}

fn update_config(update: impl FnOnce(&mut AppConfig)) -> Result<(), String> {
    let mut config: AppConfig = read_json(CONFIG_FILE);
    update(&mut config);
    write_json(CONFIG_FILE, &config)
}

#[tauri::command]
pub fn get_default_folder() -> Option<String> {
    read_json::<AppConfig>(CONFIG_FILE).default_folder
}

#[tauri::command]
pub fn set_default_folder(path: String) -> Result<(), String> {
    update_config(|config| config.default_folder = Some(path))
}

#[tauri::command]
pub fn clear_default_folder() -> Result<(), String> {
    update_config(|config| config.default_folder = None)
}

// These files are exchanged as raw JSON strings; the frontend parses them itself
fn read_config_text(file: &str) -> Result<Option<String>, String> {
    read_text(&config_path(file)?)
}

fn write_config_text(file: &str, content: &str) -> Result<(), String> {
    write_text(&config_path(file)?, content)
}

#[tauri::command]
pub fn get_keybindings() -> Result<String, String> {
    Ok(read_config_text(KEYBINDINGS_FILE)?.unwrap_or_else(|| "{}".to_string()))
}

#[tauri::command]
pub fn save_keybindings(keybindings: String) -> Result<(), String> {
    write_config_text(KEYBINDINGS_FILE, &keybindings)
}

#[tauri::command]
pub fn get_settings() -> Result<String, String> {
    Ok(read_config_text(SETTINGS_FILE)?.unwrap_or_else(|| "{}".to_string()))
}

#[tauri::command]
pub fn save_settings(settings: String) -> Result<(), String> {
    write_config_text(SETTINGS_FILE, &settings)
}

#[tauri::command]
pub fn get_custom_theme() -> Result<String, String> {
    read_config_text(THEME_FILE)?
        .ok_or_else(|| "theme.json not found in the vi-music config directory".to_string())
}
