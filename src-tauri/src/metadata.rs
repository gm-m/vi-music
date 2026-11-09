// Tag metadata (artist/title) with a persistent cache, and the artist view commands

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use tauri::State;

use crate::library::{file_name, TrackInfo};
use crate::state::AppState;
use crate::storage::{read_json, write_json};

#[derive(Serialize, Deserialize, Clone)]
pub struct ArtistInfo {
    name: String,
    track_count: usize,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TrackMeta {
    path: String,
    artist: Option<String>,
    title: Option<String>,
    // File modification time (unix secs) and size, used to detect stale cache entries
    #[serde(default)]
    mtime: u64,
    #[serde(default)]
    size: u64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct MetadataCache {
    tracks: Vec<TrackMeta>,
}

const METADATA_CACHE_FILE: &str = "metadata_cache.json";

pub type MetadataMap = HashMap<String, TrackMeta>;

fn load_metadata_cache() -> MetadataMap {
    read_json::<MetadataCache>(METADATA_CACHE_FILE)
        .tracks
        .into_iter()
        .map(|t| (t.path.clone(), t))
        .collect()
}

pub fn save_metadata_cache(cache: &MetadataMap) -> Result<(), String> {
    write_json(METADATA_CACHE_FILE, &MetadataCache { tracks: cache.values().cloned().collect() })
}

// (mtime in unix secs, size in bytes), or None if the file doesn't exist
fn file_stamp(path: &str) -> Option<(u64, u64)> {
    let meta = fs::metadata(path).ok()?;
    let mtime = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    Some((mtime, meta.len()))
}

fn extract_track_meta(path: &str, mtime: u64, size: u64) -> TrackMeta {
    use lofty::{Accessor, TaggedFileExt};
    
    let mut artist = None;
    let mut title = None;
    
    if let Ok(tagged_file) = lofty::read_from_path(path) {
        if let Some(tag) = tagged_file.primary_tag().or_else(|| tagged_file.first_tag()) {
            artist = tag.artist().map(|s| s.to_string());
            title = tag.title().map(|s| s.to_string());
        }
    }
    
    TrackMeta {
        path: path.to_string(),
        artist,
        title,
        mtime,
        size,
    }
}

impl AppState {
    pub fn with_metadata_cache<R>(&self, f: impl FnOnce(&mut MetadataMap) -> R) -> R {
        let mut guard = self.metadata_cache.lock().unwrap();
        f(guard.get_or_insert_with(load_metadata_cache))
    }
    
    // Metadata for the requested paths (in request order). Tags are (re)read only for
    // new or modified files; entries for missing files are dropped from the cache.
    pub fn track_metadata(&self, paths: &[String]) -> Vec<TrackMeta> {
        self.with_metadata_cache(|cache| {
            let mut dirty = false;
            let mut result = Vec::with_capacity(paths.len());
            for path in paths {
                let Some((mtime, size)) = file_stamp(path) else {
                    dirty |= cache.remove(path).is_some();
                    continue;
                };
                let fresh = cache.get(path).map_or(false, |t| t.mtime == mtime && t.size == size);
                if !fresh {
                    cache.insert(path.clone(), extract_track_meta(path, mtime, size));
                    dirty = true;
                }
                result.push(cache[path].clone());
            }
            if dirty {
                let _ = save_metadata_cache(cache);
            }
            result
        })
    }
}

#[tauri::command]
pub fn scan_metadata(tracks: Vec<String>, state: State<AppState>) -> Result<Vec<TrackMeta>, String> {
    Ok(state.track_metadata(&tracks))
}

#[tauri::command]
pub fn get_artists(tracks: Vec<String>, state: State<AppState>) -> Result<Vec<ArtistInfo>, String> {
    let mut artist_counts: HashMap<String, usize> = HashMap::new();
    for track in state.track_metadata(&tracks) {
        let artist_name = track.artist.unwrap_or_else(|| "Unknown Artist".to_string());
        *artist_counts.entry(artist_name).or_insert(0) += 1;
    }
    
    let mut artists: Vec<ArtistInfo> = artist_counts.into_iter()
        .map(|(name, track_count)| ArtistInfo { name, track_count })
        .collect();
    
    artists.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    
    Ok(artists)
}

#[tauri::command]
pub fn get_artist_tracks(artist: String, tracks: Vec<String>, state: State<AppState>) -> Result<Vec<TrackInfo>, String> {
    let mut result: Vec<TrackInfo> = state.track_metadata(&tracks)
        .into_iter()
        .filter(|t| t.artist.as_deref().unwrap_or("Unknown Artist") == artist)
        .map(|t| {
            // Index is set after sorting
            let mut info = TrackInfo::from_path(&t.path, 0);
            info.name = t.title.unwrap_or_else(|| file_name(&t.path));
            info
        })
        .collect();
    
    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    for (i, track) in result.iter_mut().enumerate() {
        track.index = i;
    }
    
    Ok(result)
}
