// Per-track cue points, bookmarks, CUE sheet import/export and pruning of missing files

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tauri::State;

use crate::metadata::save_metadata_cache;
use crate::state::AppState;
use crate::storage::{read_json, write_json};

const CUES_FILE: &str = "cues.json";
const BOOKMARKS_FILE: &str = "bookmarks.json";
// Cues closer than this (seconds) are considered duplicates
const CUE_DEDUP_SECS: f64 = 0.05;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(from = "StoredCue")]
pub struct Cue {
    time: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    label: Option<String>,
}

// Accepts both the legacy format (plain seconds) and `{ time, label }`
#[derive(Deserialize)]
#[serde(untagged)]
enum StoredCue {
    Time(f64),
    Full { time: f64, #[serde(default)] label: Option<String> },
}

impl From<StoredCue> for Cue {
    fn from(stored: StoredCue) -> Self {
        match stored {
            StoredCue::Time(time) => Cue { time, label: None },
            StoredCue::Full { time, label } => Cue { time, label },
        }
    }
}

type CueMap = HashMap<String, Vec<Cue>>;

// Sort, drop invalid/duplicate cues and empty labels
fn normalize_cues(mut cues: Vec<Cue>) -> Vec<Cue> {
    cues.retain(|c| c.time.is_finite() && c.time >= 0.0);
    for cue in &mut cues {
        cue.label = cue.label.take().map(|l| l.trim().to_string()).filter(|l| !l.is_empty());
    }
    cues.sort_by(|a, b| a.time.total_cmp(&b.time));
    cues.dedup_by(|b, a| (b.time - a.time).abs() < CUE_DEDUP_SECS);
    cues
}

#[tauri::command]
pub fn get_cues() -> CueMap {
    read_json(CUES_FILE)
}

#[tauri::command]
pub fn set_track_cues(path: String, cues: Vec<Cue>) -> Result<Vec<Cue>, String> {
    let mut all: CueMap = read_json(CUES_FILE);
    let cues = normalize_cues(cues);
    if cues.is_empty() {
        all.remove(&path);
    } else {
        all.insert(path, cues.clone());
    }
    write_json(CUES_FILE, &all)?;
    Ok(cues)
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Bookmark {
    track: String,
    position: f64,
}

#[tauri::command]
pub fn get_bookmarks() -> HashMap<String, Bookmark> {
    read_json(BOOKMARKS_FILE)
}

#[tauri::command]
pub fn save_bookmarks(bookmarks: HashMap<String, Bookmark>) -> Result<(), String> {
    write_json(BOOKMARKS_FILE, &bookmarks)
}

#[derive(Serialize)]
pub struct PruneResult {
    cues: usize,
    bookmarks: usize,
    metadata: usize,
}

// Remove cues, bookmarks and cached metadata that refer to files that no longer exist
#[tauri::command]
pub fn prune_missing(state: State<AppState>) -> Result<PruneResult, String> {
    let exists = |path: &String| Path::new(path).is_file();
    
    let mut cues: CueMap = read_json(CUES_FILE);
    let cues_before = cues.len();
    cues.retain(|path, _| exists(path));
    
    let mut bookmarks: HashMap<String, Bookmark> = read_json(BOOKMARKS_FILE);
    let bookmarks_before = bookmarks.len();
    bookmarks.retain(|_, b| exists(&b.track));
    
    let result = PruneResult {
        cues: cues_before - cues.len(),
        bookmarks: bookmarks_before - bookmarks.len(),
        metadata: state.with_metadata_cache(|cache| {
            let before = cache.len();
            cache.retain(|path, _| exists(path));
            before - cache.len()
        }),
    };
    
    if result.cues > 0 {
        write_json(CUES_FILE, &cues)?;
    }
    if result.bookmarks > 0 {
        write_json(BOOKMARKS_FILE, &bookmarks)?;
    }
    if result.metadata > 0 {
        state.with_metadata_cache(|cache| save_metadata_cache(cache))?;
    }
    Ok(result)
}

// CUE sheet support (INDEX times are mm:ss:ff with 75 frames per second)
const CUE_FRAMES_PER_SEC: u64 = 75;

fn format_cue_time(secs: f64) -> String {
    let frames = (secs.max(0.0) * CUE_FRAMES_PER_SEC as f64).round() as u64;
    let total_secs = frames / CUE_FRAMES_PER_SEC;
    format!("{:02}:{:02}:{:02}", total_secs / 60, total_secs % 60, frames % CUE_FRAMES_PER_SEC)
}

fn parse_cue_time(text: &str) -> Option<f64> {
    let parts: Vec<u64> = text.split(':').map(|p| p.trim().parse().ok()).collect::<Option<_>>()?;
    match parts[..] {
        [m, s, f] if s < 60 && f < CUE_FRAMES_PER_SEC => {
            Some((m * 60 + s) as f64 + f as f64 / CUE_FRAMES_PER_SEC as f64)
        }
        _ => None,
    }
}

// CUE sheets have no escaping for quotes inside strings
fn cue_quote(text: &str) -> String {
    format!("\"{}\"", text.replace('"', "'"))
}

// Value of a CUE command argument: quoted string, or first whitespace-separated token
fn cue_arg(rest: &str) -> String {
    let rest = rest.trim();
    match rest.strip_prefix('"') {
        Some(quoted) => quoted.split('"').next().unwrap_or_default().to_string(),
        None => rest.split_whitespace().next().unwrap_or_default().to_string(),
    }
}

fn build_cue_sheet(audio_path: &str, title: &str, cues: &[Cue]) -> String {
    let path = Path::new(audio_path);
    let file_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let file_type = match ext.as_str() {
        "mp3" => "MP3",
        "aif" | "aiff" => "AIFF",
        _ => "WAVE",
    };
    
    let mut out = format!("TITLE {}\nFILE {} {}\n", cue_quote(title), cue_quote(&file_name), file_type);
    for (i, cue) in cues.iter().enumerate() {
        out.push_str(&format!("  TRACK {:02} AUDIO\n", i + 1));
        if let Some(label) = &cue.label {
            out.push_str(&format!("    TITLE {}\n", cue_quote(label)));
        }
        out.push_str(&format!("    INDEX 01 {}\n", format_cue_time(cue.time)));
    }
    out
}

// Extract cues for `audio_file_name` from a CUE sheet. If the sheet references a single
// file, its tracks are used regardless of the file name.
fn parse_cue_sheet(content: &str, audio_file_name: &str) -> Result<Vec<Cue>, String> {
    // (FILE name, cues); a TRACK's time stays None until its INDEX 01 is found
    let mut files: Vec<(String, Vec<Cue>)> = Vec::new();
    let mut pending: Option<(Option<f64>, Option<String>)> = None;
    
    fn flush(pending: &mut Option<(Option<f64>, Option<String>)>, files: &mut [(String, Vec<Cue>)]) {
        if let (Some((Some(time), label)), Some((_, cues))) = (pending.take(), files.last_mut()) {
            cues.push(Cue { time, label });
        }
    }
    
    for line in content.lines() {
        let line = line.trim_start_matches('\u{feff}').trim();
        let (keyword, rest) = line.split_once(char::is_whitespace).unwrap_or((line, ""));
        match keyword.to_ascii_uppercase().as_str() {
            "FILE" => {
                flush(&mut pending, &mut files);
                files.push((cue_arg(rest), Vec::new()));
            }
            "TRACK" if !files.is_empty() => {
                flush(&mut pending, &mut files);
                pending = Some((None, None));
            }
            "TITLE" => {
                if let Some((_, label)) = pending.as_mut() {
                    *label = Some(cue_arg(rest));
                }
            }
            "INDEX" => {
                let mut args = rest.split_whitespace();
                if let (Some("01"), Some(text), Some((time, _))) = (args.next(), args.next(), pending.as_mut()) {
                    *time = Some(parse_cue_time(text).ok_or_else(|| format!("Invalid INDEX time: {}", text))?);
                }
            }
            _ => {}
        }
    }
    flush(&mut pending, &mut files);
    
    let file_matches = |name: &str| {
        Path::new(name).file_name().map_or(false, |n| n.to_string_lossy().eq_ignore_ascii_case(audio_file_name))
    };
    let cues = match files.iter().position(|(name, _)| file_matches(name)) {
        Some(i) => files.swap_remove(i).1,
        None if files.len() == 1 => files.remove(0).1,
        None if files.is_empty() => return Err("No FILE entries in CUE sheet".to_string()),
        None => return Err(format!("CUE sheet does not reference {}", audio_file_name)),
    };
    Ok(normalize_cues(cues))
}

#[tauri::command]
pub fn export_cue_sheet(audio_path: String, cue_path: String, title: String, cues: Vec<Cue>, overwrite: bool) -> Result<(), String> {
    if !overwrite && Path::new(&cue_path).exists() {
        return Err(format!("{} already exists (use :cue export! to overwrite)", cue_path));
    }
    fs::write(&cue_path, build_cue_sheet(&audio_path, &title, &cues)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_cue_sheet(audio_path: String, cue_path: String) -> Result<Vec<Cue>, String> {
    let bytes = fs::read(&cue_path).map_err(|e| e.to_string())?;
    let audio_file_name = Path::new(&audio_path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    parse_cue_sheet(&String::from_utf8_lossy(&bytes), &audio_file_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cue(time: f64, label: Option<&str>) -> Cue {
        Cue { time, label: label.map(String::from) }
    }

    #[test]
    fn cue_time_roundtrip() {
        assert_eq!(format_cue_time(0.0), "00:00:00");
        assert_eq!(format_cue_time(83.5), "01:23:38");
        assert_eq!(format_cue_time(6000.0), "100:00:00");
        assert_eq!(parse_cue_time("01:23:38"), Some(83.0 + 38.0 / 75.0));
        assert_eq!(parse_cue_time("01:60:00"), None);
        assert_eq!(parse_cue_time("01:00:75"), None);
        assert_eq!(parse_cue_time("1:00"), None);
    }

    #[test]
    fn legacy_and_labeled_cues_deserialize() {
        let map: CueMap = serde_json::from_str(r#"{"a.mp3": [10, 20.5, {"time": 30, "label": "Drop"}]}"#).unwrap();
        assert_eq!(map["a.mp3"], vec![cue(10.0, None), cue(20.5, None), cue(30.0, Some("Drop"))]);
        let json = serde_json::to_string(&map["a.mp3"]).unwrap();
        assert_eq!(json, r#"[{"time":10.0},{"time":20.5},{"time":30.0,"label":"Drop"}]"#);
    }

    #[test]
    fn normalize_sorts_dedups_and_trims() {
        let cues = normalize_cues(vec![
            cue(30.0, Some("  ")),
            cue(10.0, Some(" Intro ")),
            cue(10.01, None),
            cue(-1.0, None),
        ]);
        assert_eq!(cues, vec![cue(10.0, Some("Intro")), cue(30.0, None)]);
    }

    #[test]
    fn cue_sheet_roundtrip() {
        let cues = vec![cue(0.0, Some("Intro")), cue(83.0, None), cue(120.4, Some("Say \"hi\""))];
        let sheet = build_cue_sheet(r"C:\music\Song.mp3", "Song", &cues);
        assert!(sheet.contains("FILE \"Song.mp3\" MP3"));
        let parsed = parse_cue_sheet(&sheet, "song.MP3").unwrap();
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0], cue(0.0, Some("Intro")));
        assert_eq!(parsed[1], cue(83.0, None));
        assert!((parsed[2].time - 120.4).abs() < 1.0 / 75.0);
        assert_eq!(parsed[2].label.as_deref(), Some("Say 'hi'"));
    }

    #[test]
    fn cue_sheet_picks_matching_file() {
        let sheet = "\u{feff}PERFORMER \"X\"\nFILE \"a.flac\" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:10:00\nFILE \"b.flac\" WAVE\n  TRACK 02 AUDIO\n    TITLE \"B1\"\n    INDEX 00 00:00:00\n    INDEX 01 00:05:00\n";
        assert_eq!(parse_cue_sheet(sheet, "b.flac").unwrap(), vec![cue(5.0, Some("B1"))]);
        assert_eq!(parse_cue_sheet(sheet, "a.flac").unwrap(), vec![cue(10.0, None)]);
        assert!(parse_cue_sheet(sheet, "c.flac").is_err());
        // Single-file sheets apply even if the file name differs
        let single = "FILE \"old name.wav\" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:01:00\n";
        assert_eq!(parse_cue_sheet(single, "new.wav").unwrap(), vec![cue(1.0, None)]);
    }
}
