// Scanning folders for audio files, track durations and library folders

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;
use walkdir::WalkDir;

use symphonia::core::codecs::CODEC_TYPE_NULL;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::state::AppState;
use crate::storage::{config_path, read_json, read_json_file, write_json};

const LIBRARY_FOLDERS_FILE: &str = "library_folders.json";

#[derive(Serialize, Deserialize, Clone)]
pub struct TrackInfo {
    pub path: String,
    pub name: String,
    pub index: usize,
    pub duration: Option<u64>,
}

pub fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default()
}

impl TrackInfo {
    // Track named after its file name, with its duration read from the file
    pub fn from_path(path: &str, index: usize) -> Self {
        TrackInfo {
            path: path.to_string(),
            name: file_name(path),
            index,
            duration: get_audio_duration(path),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct FolderItem {
    name: String,
    path: String,
    is_folder: bool,
    track_count: usize,
    duration: Option<u64>,
}

#[derive(Serialize, Deserialize)]
pub struct FolderContents {
    path: String,
    parent: Option<String>,
    items: Vec<FolderItem>,
}

pub fn get_audio_duration(path: &str) -> Option<u64> {
    let ext = Path::new(path).extension()?.to_str()?.to_lowercase();
    
    match ext.as_str() {
        "mp3" => {
            // Try mp3_duration first, fall back to symphonia if it fails
            // (mp3_duration fails on some MP3s with embedded cover art)
            if let Some(d) = mp3_duration::from_path(path).ok().map(|d| d.as_secs()) {
                return Some(d);
            }
            symphonia_duration(path)
        }
        _ => {
            // Try symphonia first (more reliable), fall back to rodio decoder
            if let Some(d) = symphonia_duration(path) {
                return Some(d);
            }
            use rodio::{Decoder, Source};
            use std::fs::File;
            use std::io::BufReader;
            
            let file = File::open(path).ok()?;
            let source = Decoder::new(BufReader::new(file)).ok()?;
            source.total_duration().map(|d| d.as_secs())
        }
    }
}

fn symphonia_duration(path: &str) -> Option<u64> {
    let file = fs::File::open(path).ok()?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    
    let ext = Path::new(path).extension()?.to_str()?.to_lowercase();
    
    let mut hint = Hint::new();
    hint.with_extension(&ext);
    
    let format_opts = FormatOptions::default();
    let metadata_opts = MetadataOptions::default();
    
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &format_opts, &metadata_opts)
        .ok()?;
    
    let format = probed.format;
    
    let track = format.tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)?;
    
    let sample_rate = track.codec_params.sample_rate? as u64;
    if sample_rate == 0 {
        return None;
    }
    let n_frames = track.codec_params.n_frames?;
    
    Some(n_frames / sample_rate)
}

pub fn is_audio_file(path: &Path) -> bool {
    if let Some(ext) = path.extension() {
        let ext = ext.to_string_lossy().to_lowercase();
        matches!(ext.as_str(), "mp3" | "wav" | "flac" | "ogg" | "m4a" | "aif" | "aiff")
    } else {
        false
    }
}

#[tauri::command]
pub fn load_folder(path: String, state: State<AppState>) -> Result<Vec<TrackInfo>, String> {
    let mut tracks = Vec::new();
    
    for entry in WalkDir::new(&path).into_iter().filter_map(|e| e.ok()) {
        let entry_path = entry.path();
        if entry_path.is_file() && is_audio_file(entry_path) {
            tracks.push(entry_path.to_string_lossy().to_string());
        }
    }
    
    tracks.sort();
    
    let track_infos: Vec<TrackInfo> = tracks
        .iter()
        .enumerate()
        .map(|(i, p)| TrackInfo::from_path(p, i))
        .collect();
    
    *state.playlist.lock().unwrap() = tracks;
    *state.current_index.lock().unwrap() = 0;
    
    Ok(track_infos)
}

#[tauri::command]
pub fn browse_folder(path: String, root_path: String) -> Result<FolderContents, String> {
    let path_buf = PathBuf::from(&path);
    let root_buf = PathBuf::from(&root_path);
    
    if !path_buf.exists() || !path_buf.is_dir() {
        return Err("Invalid folder path".to_string());
    }
    
    let parent = if path_buf != root_buf {
        path_buf.parent().map(|p| p.to_string_lossy().to_string())
    } else {
        None
    };
    
    let mut items = Vec::new();
    
    if let Ok(entries) = fs::read_dir(&path) {
        for entry in entries.filter_map(|e| e.ok()) {
            let entry_path = entry.path();
            let name = entry_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            
            if entry_path.is_dir() {
                let track_count = count_audio_files(&entry_path);
                if track_count > 0 {
                    items.push(FolderItem {
                        name,
                        path: entry_path.to_string_lossy().to_string(),
                        is_folder: true,
                        track_count,
                        duration: None,
                    });
                }
            } else if is_audio_file(&entry_path) {
                let duration = get_audio_duration(&entry_path.to_string_lossy());
                items.push(FolderItem {
                    name,
                    path: entry_path.to_string_lossy().to_string(),
                    is_folder: false,
                    track_count: 0,
                    duration,
                });
            }
        }
    }
    
    items.sort_by(|a, b| {
        match (a.is_folder, b.is_folder) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });
    
    Ok(FolderContents {
        path,
        parent,
        items,
    })
}

fn count_audio_files(path: &Path) -> usize {
    WalkDir::new(path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file() && is_audio_file(e.path()))
        .count()
}

// Library folder management
#[tauri::command]
pub fn get_library_folders() -> Result<Vec<String>, String> {
    Ok(read_json_file(&config_path(LIBRARY_FOLDERS_FILE)?)?.unwrap_or_default())
}

#[tauri::command]
pub fn add_library_folder(folder: String) -> Result<Vec<String>, String> {
    let mut folders: Vec<String> = read_json(LIBRARY_FOLDERS_FILE);
    if !folders.contains(&folder) {
        folders.push(folder);
        write_json(LIBRARY_FOLDERS_FILE, &folders)?;
    }
    Ok(folders)
}

#[tauri::command]
pub fn remove_library_folder(folder: String) -> Result<Vec<String>, String> {
    if !config_path(LIBRARY_FOLDERS_FILE)?.exists() {
        return Ok(Vec::new());
    }
    let mut folders: Vec<String> = read_json(LIBRARY_FOLDERS_FILE);
    folders.retain(|f| f != &folder);
    write_json(LIBRARY_FOLDERS_FILE, &folders)?;
    Ok(folders)
}

#[tauri::command]
pub fn scan_library_folder(folder: String) -> Result<Vec<TrackInfo>, String> {
    let path = PathBuf::from(&folder);
    if !path.exists() || !path.is_dir() {
        return Err(format!("Folder not found: {}", folder));
    }
    
    let mut tracks = Vec::new();
    scan_folder_recursive(&path, &mut tracks);
    
    tracks.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    for (i, track) in tracks.iter_mut().enumerate() {
        track.index = i;
    }
    Ok(tracks)
}

fn scan_folder_recursive(dir: &Path, tracks: &mut Vec<TrackInfo>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_dir() {
                scan_folder_recursive(&path, tracks);
            } else if is_audio_file(&path) {
                // Index is set after sorting
                tracks.push(TrackInfo::from_path(&path.to_string_lossy(), 0));
            }
        }
    }
}

#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        // Try common file managers with selection support
        let parent = Path::new(&path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());
        std::process::Command::new("xdg-open")
            .arg(&parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
