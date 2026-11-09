// Persistence helpers for files in the vi-music config directory

use serde::{de::DeserializeOwned, Serialize};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

pub fn config_dir() -> Result<PathBuf, String> {
    dirs::config_dir()
        .map(|p| p.join("vi-music"))
        .ok_or_else(|| "Could not determine config directory".to_string())
}

pub fn config_path(file: &str) -> Result<PathBuf, String> {
    Ok(config_dir()?.join(file))
}

pub fn playlists_dir() -> Result<PathBuf, String> {
    config_path("playlists")
}

// File contents, or None if the file doesn't exist
pub fn read_text(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

// Write a file, creating its parent directories if needed
pub fn write_text(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, content).map_err(|e| e.to_string())
}

// Parsed JSON file, or None if the file doesn't exist; invalid JSON is an error
pub fn read_json_file<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    read_text(path)?
        .map(|content| serde_json::from_str(&content).map_err(|e| e.to_string()))
        .transpose()
}

pub fn write_json_file<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let content = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    write_text(path, &content)
}

// Read a JSON file from the config directory, falling back to the default value
// if it is missing or invalid
pub fn read_json<T: DeserializeOwned + Default>(file: &str) -> T {
    config_path(file)
        .ok()
        .and_then(|path| read_json_file(&path).ok().flatten())
        .unwrap_or_default()
}

pub fn write_json<T: Serialize>(file: &str, value: &T) -> Result<(), String> {
    write_json_file(&config_path(file)?, value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_file_roundtrip_missing_and_invalid() {
        let dir = std::env::temp_dir().join(format!("vi-music-test-{}", std::process::id()));
        let path = dir.join("nested").join("data.json");
        
        assert_eq!(read_json_file::<Vec<u32>>(&path).unwrap(), None);
        write_json_file(&path, &vec![1u32, 2, 3]).unwrap();
        assert_eq!(read_json_file::<Vec<u32>>(&path).unwrap(), Some(vec![1, 2, 3]));
        
        write_text(&path, "not json").unwrap();
        assert!(read_json_file::<Vec<u32>>(&path).is_err());
        
        fs::remove_dir_all(&dir).unwrap();
    }
}
