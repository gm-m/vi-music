// Saved playlists: one JSON file per playlist in the config `playlists` directory

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

use crate::library::TrackInfo;
use crate::state::AppState;
use crate::storage::{playlists_dir, read_json_file, write_json_file};

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

// Reads an existing playlist, failing with `Playlist '<name>' not found` if missing
fn read_existing(path: &Path, name: &str) -> Result<SavedPlaylist, String> {
    read_json_file(path)?.ok_or_else(|| format!("Playlist '{}' not found", name))
}

#[tauri::command]
pub fn save_playlist(name: String, state: State<AppState>) -> Result<(), String> {
    let saved = SavedPlaylist {
        tracks: state.playlist.lock().unwrap().clone(),
        name,
    };
    write_json_file(&playlist_path(&saved.name)?, &saved)
}

#[tauri::command]
pub fn load_playlist(name: String, state: State<AppState>) -> Result<Vec<TrackInfo>, String> {
    let saved: SavedPlaylist = read_json_file(&playlist_path(&name)?)?.ok_or("Playlist not found")?;
    
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
    fs::remove_file(playlist_path(&name)?).map_err(|_| "Failed to delete playlist".to_string())
}

#[tauri::command]
pub fn duplicate_playlist(name: String) -> Result<String, String> {
    let mut playlist = read_existing(&playlist_path(&name)?, &name)?;
    
    // Generate a unique name: "name (copy)", "name (copy 2)", ...
    let mut new_name = format!("{} (copy)", name);
    let mut counter = 2;
    while playlist_path(&new_name)?.exists() {
        new_name = format!("{} (copy {})", name, counter);
        counter += 1;
    }
    
    playlist.name = new_name.clone();
    write_json_file(&playlist_path(&new_name)?, &playlist)?;
    Ok(new_name)
}

#[tauri::command]
pub fn rename_playlist(old_name: String, new_name: String) -> Result<(), String> {
    let old_path = playlist_path(&old_name)?;
    let new_path = playlist_path(&new_name)?;
    
    let mut playlist = read_existing(&old_path, &old_name)?;
    if old_path != new_path && new_path.exists() {
        return Err(format!("Playlist '{}' already exists", new_name));
    }
    
    // Update the name and save to the new file
    playlist.name = new_name;
    write_json_file(&new_path, &playlist)?;
    if old_path != new_path {
        fs::remove_file(&old_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn create_playlist(name: String) -> Result<(), String> {
    let path = playlist_path(&name)?;
    if path.exists() {
        return Err("Playlist already exists".to_string());
    }
    write_json_file(&path, &SavedPlaylist { name, tracks: Vec::new() })
}

#[tauri::command]
pub fn add_tracks_to_playlist(name: String, tracks: Vec<String>) -> Result<usize, String> {
    let path = playlist_path(&name)?;
    // Create the playlist if it doesn't exist
    let mut saved = read_json_file(&path)?.unwrap_or_else(|| SavedPlaylist { name, tracks: Vec::new() });
    
    // Add tracks that aren't already in the playlist
    let mut added = 0;
    for track in tracks {
        if !saved.tracks.contains(&track) {
            saved.tracks.push(track);
            added += 1;
        }
    }
    
    write_json_file(&path, &saved)?;
    Ok(added)
}
