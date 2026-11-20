// Saved playlists: one JSON file per playlist in the config `playlists` directory

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

use crate::library::TrackInfo;
use crate::state::AppState;
use crate::storage::{create_json_file, playlists_dir, read_json_file, write_json_file};

static PLAYLIST_WRITES: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize, Clone)]
struct SavedPlaylist {
    name: String,
    tracks: Vec<String>, // File paths
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PlaylistInfo {
    name: String,
    track_count: usize,
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' { c } else { '_' })
        .collect()
}

fn playlist_path(name: &str) -> Result<PathBuf, String> {
    Ok(playlists_dir()?.join(format!("{}.json", sanitize_filename(name))))
}

fn read_named(path: &Path, name: &str) -> Result<Option<SavedPlaylist>, String> {
    let saved: Option<SavedPlaylist> = read_json_file(path)?;
    if let Some(saved) = &saved {
        if saved.name != name {
            return Err(format!("Playlist name '{}' conflicts with existing playlist '{}'", name, saved.name));
        }
    }
    Ok(saved)
}

fn read_existing(path: &Path, name: &str) -> Result<SavedPlaylist, String> {
    read_named(path, name)?.ok_or_else(|| format!("Playlist '{}' not found", name))
}

fn save_named(path: &Path, saved: &SavedPlaylist) -> Result<(), String> {
    if read_named(path, &saved.name)?.is_some() {
        write_json_file(path, saved)
    } else {
        create_json_file(path, saved)
    }
}

#[tauri::command]
pub fn save_playlist(name: String, state: State<AppState>) -> Result<(), String> {
    let _write = PLAYLIST_WRITES.lock().unwrap();
    let saved = SavedPlaylist {
        tracks: state.playlist.lock().unwrap().clone(),
        name,
    };
    save_named(&playlist_path(&saved.name)?, &saved)
}

#[tauri::command]
pub fn load_playlist(name: String, state: State<AppState>) -> Result<Vec<TrackInfo>, String> {
    let saved = read_existing(&playlist_path(&name)?, &name)?;
    
    // Filter out tracks that no longer exist
    let valid_tracks: Vec<String> = saved.tracks
        .into_iter()
        .filter(|p| Path::new(p).exists())
        .collect();
    
    let track_infos = valid_tracks
        .iter()
        .enumerate()
        .map(|(i, p)| TrackInfo::from_path(p, i))
        .collect();
    
    *state.playlist.lock().unwrap() = valid_tracks;
    *state.current_index.lock().unwrap() = 0;
    
    Ok(track_infos)
}

#[tauri::command]
pub fn list_playlists() -> Result<Vec<PlaylistInfo>, String> {
    let Ok(entries) = fs::read_dir(playlists_dir()?) else {
        return Ok(Vec::new());
    };
    
    let mut playlists: Vec<PlaylistInfo> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|path| path.extension().map_or(false, |e| e == "json"))
        .filter_map(|path| read_json_file::<SavedPlaylist>(&path).ok().flatten())
        .map(|saved| PlaylistInfo { name: saved.name, track_count: saved.tracks.len() })
        .collect();
    
    playlists.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(playlists)
}

#[tauri::command]
pub fn delete_playlist(name: String) -> Result<(), String> {
    let _write = PLAYLIST_WRITES.lock().unwrap();
    let path = playlist_path(&name)?;
    read_existing(&path, &name)?;
    fs::remove_file(path).map_err(|_| "Failed to delete playlist".to_string())
}

#[tauri::command]
pub fn duplicate_playlist(name: String) -> Result<String, String> {
    let _write = PLAYLIST_WRITES.lock().unwrap();
    let mut playlist = read_existing(&playlist_path(&name)?, &name)?;
    
    // Generate a unique name: "name (copy)", "name (copy 2)", ...
    let mut new_name = format!("{} (copy)", name);
    let mut counter = 2;
    while playlist_path(&new_name)?.exists() {
        new_name = format!("{} (copy {})", name, counter);
        counter += 1;
    }
    
    playlist.name = new_name.clone();
    create_json_file(&playlist_path(&new_name)?, &playlist)?;
    Ok(new_name)
}

#[tauri::command]
pub fn rename_playlist(old_name: String, new_name: String) -> Result<(), String> {
    let _write = PLAYLIST_WRITES.lock().unwrap();
    let old_path = playlist_path(&old_name)?;
    let new_path = playlist_path(&new_name)?;
    
    let mut playlist = read_existing(&old_path, &old_name)?;
    if old_path != new_path && new_path.exists() {
        return Err(format!("Playlist '{}' already exists", new_name));
    }
    
    // Update the name and save to the new file
    playlist.name = new_name;
    if old_path == new_path {
        write_json_file(&new_path, &playlist)?;
    } else {
        create_json_file(&new_path, &playlist)?;
        if let Err(err) = fs::remove_file(&old_path) {
            let _ = fs::remove_file(&new_path);
            return Err(err.to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn create_playlist(name: String) -> Result<(), String> {
    let _write = PLAYLIST_WRITES.lock().unwrap();
    let path = playlist_path(&name)?;
    if path.exists() {
        return Err("Playlist already exists".to_string());
    }
    create_json_file(&path, &SavedPlaylist { name, tracks: Vec::new() })
}

#[tauri::command]
pub fn add_tracks_to_playlist(name: String, tracks: Vec<String>) -> Result<usize, String> {
    let _write = PLAYLIST_WRITES.lock().unwrap();
    let path = playlist_path(&name)?;
    // Create the playlist if it doesn't exist
    let mut saved = read_named(&path, &name)?.unwrap_or_else(|| SavedPlaylist { name, tracks: Vec::new() });
    
    // Add tracks that aren't already in the playlist
    let mut added = 0;
    for track in tracks {
        if !saved.tracks.contains(&track) {
            saved.tracks.push(track);
            added += 1;
        }
    }
    
    save_named(&path, &saved)?;
    Ok(added)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colliding_names_cannot_overwrite_an_existing_playlist() {
        let dir = std::env::temp_dir().join(format!("vi-music-playlist-test-{}", std::process::id()));
        let path = dir.join(format!("{}.json", sanitize_filename("Mix+Live")));
        let mut playlist = SavedPlaylist { name: "Mix+Live".into(), tracks: vec!["one.wav".into()] };
        save_named(&path, &playlist).unwrap();

        let conflicting = SavedPlaylist { name: "Mix_Live".into(), tracks: vec!["two.wav".into()] };
        assert_eq!(sanitize_filename(&playlist.name), sanitize_filename(&conflicting.name));
        assert!(save_named(&path, &conflicting).is_err());
        assert!(read_existing(&path, &conflicting.name).is_err());
        assert_eq!(read_existing(&path, &playlist.name).unwrap().tracks, playlist.tracks);

        playlist.tracks.push("three.wav".into());
        save_named(&path, &playlist).unwrap();
        assert_eq!(read_existing(&path, &playlist.name).unwrap().tracks, playlist.tracks);
        fs::remove_file(path).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}
