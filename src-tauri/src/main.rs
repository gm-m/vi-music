#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;
use tauri::State;
use walkdir::WalkDir;

#[derive(Serialize, Deserialize, Default)]
struct AppConfig {
    default_folder: Option<String>,
}

fn get_config_path() -> Option<PathBuf> {
    dirs::config_dir().map(|p| p.join("vi-music").join("config.json"))
}

fn load_config() -> AppConfig {
    if let Some(path) = get_config_path() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(config) = serde_json::from_str(&content) {
                return config;
            }
        }
    }
    AppConfig::default()
}

fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = get_config_path().ok_or("Could not determine config path")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Clone)]
enum AudioCommand {
    Play(String, f32, u64),
    Pause,
    Resume,
    Stop,
    SetVolume(f32),
    Seek(u64),
}

struct PlaybackState {
    start_time: Option<Instant>,
    start_position: u64,
    is_paused: bool,
    pause_time: Option<Instant>,
    current_path: Option<String>,
    duration: Option<u64>,
    is_finished: bool,
}

impl PlaybackState {
    fn new() -> Self {
        Self {
            start_time: None,
            start_position: 0,
            is_paused: false,
            pause_time: None,
            current_path: None,
            duration: None,
            is_finished: false,
        }
    }
    
    fn get_elapsed(&self) -> u64 {
        if let Some(start) = self.start_time {
            if self.is_paused {
                if let Some(pause) = self.pause_time {
                    return self.start_position + pause.duration_since(start).as_secs();
                }
            }
            self.start_position + start.elapsed().as_secs()
        } else {
            0
        }
    }
}

struct AudioPlayer {
    command_tx: Sender<AudioCommand>,
    playback_state: Arc<Mutex<PlaybackState>>,
}

impl AudioPlayer {
    fn new() -> Self {
        let (tx, rx) = channel::<AudioCommand>();
        let playback_state = Arc::new(Mutex::new(PlaybackState::new()));
        let state_clone = playback_state.clone();
        
        thread::spawn(move || {
            use rodio::{Decoder, OutputStream, Sink};
            use std::fs::File;
            use std::io::BufReader;
            use std::time::Duration;
            
            let (_stream, stream_handle) = OutputStream::try_default().unwrap();
            let mut current_sink: Option<Sink> = None;
            
            fn play_file(path: &str, volume: f32, seek_secs: u64, stream_handle: &rodio::OutputStreamHandle) -> Option<Sink> {
                use rodio::Source;
                use std::path::Path;
                
                let ext = Path::new(path).extension()?.to_str()?.to_lowercase();
                let file = File::open(path).ok()?;
                let source = Decoder::new(BufReader::new(file)).ok()?;
                let sink = Sink::try_new(stream_handle).ok()?;
                sink.set_volume(volume);
                
                if seek_secs > 0 && ext == "flac" {
                    // FLAC: use skip_duration (symphonia FLAC seeking is unreliable)
                    let skipped = source.skip_duration(Duration::from_secs(seek_secs));
                    sink.append(skipped);
                } else {
                    sink.append(source);
                    if seek_secs > 0 {
                        // MP3/WAV: use fast seek
                        let _ = sink.try_seek(Duration::from_secs(seek_secs));
                    }
                }
                Some(sink)
            }
            
            loop {
                // Check if track finished
                if let Some(ref sink) = current_sink {
                    if sink.empty() {
                        let mut state = state_clone.lock().unwrap();
                        if !state.is_finished && state.start_time.is_some() {
                            state.is_finished = true;
                        }
                    }
                }
                
                // Use timeout to periodically check sink status
                match rx.recv_timeout(Duration::from_millis(100)) {
                    Ok(cmd) => match cmd {
                        AudioCommand::Play(path, volume, skip_secs) => {
                            if let Some(sink) = current_sink.take() {
                                sink.stop();
                            }
                            if let Some(sink) = play_file(&path, volume, skip_secs, &stream_handle) {
                                current_sink = Some(sink);
                                
                                let mut state = state_clone.lock().unwrap();
                                state.start_time = Some(Instant::now());
                                state.start_position = skip_secs;
                                state.is_paused = false;
                                state.pause_time = None;
                                state.current_path = Some(path);
                                state.is_finished = false;
                            }
                        }
                        AudioCommand::Pause => {
                            if let Some(ref sink) = current_sink {
                                sink.pause();
                                let mut state = state_clone.lock().unwrap();
                                state.is_paused = true;
                                state.pause_time = Some(Instant::now());
                            }
                        }
                        AudioCommand::Resume => {
                            if let Some(ref sink) = current_sink {
                                sink.play();
                                let mut state = state_clone.lock().unwrap();
                                if state.is_paused {
                                    if let (Some(start), Some(pause)) = (state.start_time, state.pause_time) {
                                        let paused_duration = pause.duration_since(start);
                                        state.start_position += paused_duration.as_secs();
                                        state.start_time = Some(Instant::now());
                                    }
                                }
                                state.is_paused = false;
                                state.pause_time = None;
                            }
                        }
                        AudioCommand::Stop => {
                            if let Some(sink) = current_sink.take() {
                                sink.stop();
                            }
                            let mut state = state_clone.lock().unwrap();
                            state.start_time = None;
                            state.start_position = 0;
                            state.is_paused = false;
                            state.pause_time = None;
                            state.current_path = None;
                        }
                        AudioCommand::SetVolume(vol) => {
                            if let Some(ref sink) = current_sink {
                                sink.set_volume(vol);
                            }
                        }
                        AudioCommand::Seek(position) => {
                            let state = state_clone.lock().unwrap();
                            if let Some(ref path) = state.current_path.clone() {
                                let ext = std::path::Path::new(&path)
                                    .extension()
                                    .and_then(|e| e.to_str())
                                    .map(|e| e.to_lowercase())
                                    .unwrap_or_default();
                                
                                // For non-FLAC, try fast seek on current sink first
                                let seek_duration = Duration::from_secs(position);
                                let seek_success = if ext != "flac" {
                                    if let Some(ref sink) = current_sink {
                                        sink.try_seek(seek_duration).is_ok()
                                    } else {
                                        false
                                    }
                                } else {
                                    false
                                };
                                
                                if seek_success {
                                    // Fast seek worked, just update the state
                                    drop(state);
                                    let mut state = state_clone.lock().unwrap();
                                    state.start_time = Some(Instant::now());
                                    state.start_position = position;
                                } else {
                                    // Recreate sink with seek position
                                    let volume = if let Some(ref sink) = current_sink {
                                        sink.volume()
                                    } else {
                                        1.0
                                    };
                                    drop(state);
                                    
                                    if let Some(sink) = current_sink.take() {
                                        sink.stop();
                                    }
                                    
                                    if let Some(sink) = play_file(&path, volume, position, &stream_handle) {
                                        current_sink = Some(sink);
                                        
                                        let mut state = state_clone.lock().unwrap();
                                        state.start_time = Some(Instant::now());
                                        state.start_position = position;
                                        state.is_paused = false;
                                        state.pause_time = None;
                                        state.is_finished = false;
                                    }
                                }
                            }
                        }
                    },
                    Err(_) => {
                        // Timeout - continue loop to check sink status
                    }
                }
            }
        });
        
        Self { command_tx: tx, playback_state }
    }
    
    fn send(&self, cmd: AudioCommand) {
        let _ = self.command_tx.send(cmd);
    }
    
    fn get_elapsed(&self) -> u64 {
        self.playback_state.lock().unwrap().get_elapsed()
    }
    
    fn is_finished(&self) -> bool {
        self.playback_state.lock().unwrap().is_finished
    }
}

struct AppState {
    player: AudioPlayer,
    playlist: Mutex<Vec<String>>,
    current_index: Mutex<usize>,
    current_track: Mutex<Option<String>>,
    current_duration: Mutex<Option<u64>>,
    volume: Mutex<f32>,
    is_playing: Mutex<bool>,
    is_paused: Mutex<bool>,
}

impl AppState {
    fn new() -> Self {
        Self {
            player: AudioPlayer::new(),
            playlist: Mutex::new(Vec::new()),
            current_index: Mutex::new(0),
            current_track: Mutex::new(None),
            current_duration: Mutex::new(None),
            volume: Mutex::new(1.0),
            is_playing: Mutex::new(false),
            is_paused: Mutex::new(false),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct TrackInfo {
    path: String,
    name: String,
    index: usize,
    duration: Option<u64>,
}

fn get_audio_duration(path: &str) -> Option<u64> {
    let path_buf = std::path::Path::new(path);
    let ext = path_buf.extension()?.to_str()?.to_lowercase();
    
    match ext.as_str() {
        "mp3" => {
            mp3_duration::from_path(path).ok().map(|d| d.as_secs())
        }
        _ => {
            use rodio::{Decoder, Source};
            use std::fs::File;
            use std::io::BufReader;
            
            let file = File::open(path).ok()?;
            let source = Decoder::new(BufReader::new(file)).ok()?;
            source.total_duration().map(|d| d.as_secs())
        }
    }
}

#[derive(Serialize, Deserialize)]
struct PlayerStatus {
    is_playing: bool,
    is_paused: bool,
    is_finished: bool,
    current_track: Option<String>,
    current_index: usize,
    volume: f32,
    playlist_length: usize,
    elapsed: u64,
    duration: Option<u64>,
}

fn is_audio_file(path: &PathBuf) -> bool {
    if let Some(ext) = path.extension() {
        let ext = ext.to_string_lossy().to_lowercase();
        matches!(ext.as_str(), "mp3" | "wav" | "flac")
    } else {
        false
    }
}

#[tauri::command]
fn load_folder(path: String, state: State<AppState>) -> Result<Vec<TrackInfo>, String> {
    let mut tracks = Vec::new();
    
    for entry in WalkDir::new(&path).into_iter().filter_map(|e| e.ok()) {
        let path_buf = entry.path().to_path_buf();
        if path_buf.is_file() && is_audio_file(&path_buf) {
            tracks.push(path_buf.to_string_lossy().to_string());
        }
    }
    
    tracks.sort();
    
    let track_infos: Vec<TrackInfo> = tracks
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let name = PathBuf::from(p)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let duration = get_audio_duration(p);
            TrackInfo {
                path: p.clone(),
                name,
                index: i,
                duration,
            }
        })
        .collect();
    
    *state.playlist.lock().unwrap() = tracks;
    *state.current_index.lock().unwrap() = 0;
    
    Ok(track_infos)
}

#[tauri::command]
fn play_track(index: usize, state: State<AppState>) -> Result<TrackInfo, String> {
    let playlist = state.playlist.lock().unwrap();
    
    if index >= playlist.len() {
        return Err("Invalid track index".to_string());
    }
    
    let path = playlist[index].clone();
    drop(playlist);
    
    let duration = get_audio_duration(&path);
    *state.current_duration.lock().unwrap() = duration;
    
    let volume = *state.volume.lock().unwrap();
    state.player.send(AudioCommand::Play(path.clone(), volume, 0));
    
    *state.current_index.lock().unwrap() = index;
    *state.is_playing.lock().unwrap() = true;
    *state.is_paused.lock().unwrap() = false;
    
    let name = PathBuf::from(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    
    *state.current_track.lock().unwrap() = Some(name.clone());
    
    Ok(TrackInfo {
        path,
        name,
        index,
        duration,
    })
}

#[tauri::command]
fn toggle_pause(state: State<AppState>) -> Result<bool, String> {
    let is_playing = *state.is_playing.lock().unwrap();
    if !is_playing {
        return Err("No track is playing".to_string());
    }
    
    let mut is_paused = state.is_paused.lock().unwrap();
    if *is_paused {
        state.player.send(AudioCommand::Resume);
        *is_paused = false;
        Ok(false)
    } else {
        state.player.send(AudioCommand::Pause);
        *is_paused = true;
        Ok(true)
    }
}

#[tauri::command]
fn stop(state: State<AppState>) -> Result<(), String> {
    state.player.send(AudioCommand::Stop);
    *state.is_playing.lock().unwrap() = false;
    *state.is_paused.lock().unwrap() = false;
    *state.current_track.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
fn next_track(state: State<AppState>) -> Result<TrackInfo, String> {
    let playlist_len = state.playlist.lock().unwrap().len();
    if playlist_len == 0 {
        return Err("Playlist is empty".to_string());
    }
    
    let current = *state.current_index.lock().unwrap();
    let next_index = (current + 1) % playlist_len;
    
    let playlist = state.playlist.lock().unwrap();
    let path = playlist[next_index].clone();
    drop(playlist);
    
    let duration = get_audio_duration(&path);
    *state.current_duration.lock().unwrap() = duration;
    
    let volume = *state.volume.lock().unwrap();
    state.player.send(AudioCommand::Play(path.clone(), volume, 0));
    
    *state.current_index.lock().unwrap() = next_index;
    *state.is_playing.lock().unwrap() = true;
    *state.is_paused.lock().unwrap() = false;
    
    let name = PathBuf::from(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    
    *state.current_track.lock().unwrap() = Some(name.clone());
    
    Ok(TrackInfo {
        path,
        name,
        index: next_index,
        duration,
    })
}

#[tauri::command]
fn prev_track(state: State<AppState>) -> Result<TrackInfo, String> {
    let playlist_len = state.playlist.lock().unwrap().len();
    if playlist_len == 0 {
        return Err("Playlist is empty".to_string());
    }
    
    let current = *state.current_index.lock().unwrap();
    let prev_index = if current == 0 { playlist_len - 1 } else { current - 1 };
    
    let playlist = state.playlist.lock().unwrap();
    let path = playlist[prev_index].clone();
    drop(playlist);
    
    let duration = get_audio_duration(&path);
    *state.current_duration.lock().unwrap() = duration;
    
    let volume = *state.volume.lock().unwrap();
    state.player.send(AudioCommand::Play(path.clone(), volume, 0));
    
    *state.current_index.lock().unwrap() = prev_index;
    *state.is_playing.lock().unwrap() = true;
    *state.is_paused.lock().unwrap() = false;
    
    let name = PathBuf::from(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    
    *state.current_track.lock().unwrap() = Some(name.clone());
    
    Ok(TrackInfo {
        path,
        name,
        index: prev_index,
        duration,
    })
}

#[tauri::command]
fn set_volume(volume: f32, state: State<AppState>) -> Result<f32, String> {
    let clamped = volume.clamp(0.0, 1.0);
    *state.volume.lock().unwrap() = clamped;
    state.player.send(AudioCommand::SetVolume(clamped));
    Ok(clamped)
}

#[tauri::command]
fn get_status(state: State<AppState>) -> PlayerStatus {
    PlayerStatus {
        is_playing: *state.is_playing.lock().unwrap(),
        is_paused: *state.is_paused.lock().unwrap(),
        is_finished: state.player.is_finished(),
        current_track: state.current_track.lock().unwrap().clone(),
        current_index: *state.current_index.lock().unwrap(),
        volume: *state.volume.lock().unwrap(),
        playlist_length: state.playlist.lock().unwrap().len(),
        elapsed: state.player.get_elapsed(),
        duration: *state.current_duration.lock().unwrap(),
    }
}

#[tauri::command]
fn seek(position: u64, state: State<AppState>) -> Result<u64, String> {
    let is_playing = *state.is_playing.lock().unwrap();
    if !is_playing {
        return Err("No track is playing".to_string());
    }
    
    let duration = state.current_duration.lock().unwrap();
    let max_pos = duration.unwrap_or(u64::MAX);
    let clamped = position.min(max_pos);
    
    state.player.send(AudioCommand::Seek(clamped));
    Ok(clamped)
}

#[tauri::command]
fn seek_relative(delta: i64, state: State<AppState>) -> Result<u64, String> {
    let is_playing = *state.is_playing.lock().unwrap();
    if !is_playing {
        return Err("No track is playing".to_string());
    }
    
    let current = state.player.get_elapsed() as i64;
    let duration = state.current_duration.lock().unwrap();
    let max_pos = duration.unwrap_or(u64::MAX) as i64;
    
    let new_pos = (current + delta).max(0).min(max_pos) as u64;
    
    state.player.send(AudioCommand::Seek(new_pos));
    Ok(new_pos)
}

#[tauri::command]
fn get_default_folder() -> Option<String> {
    load_config().default_folder
}

#[tauri::command]
fn set_default_folder(path: String) -> Result<(), String> {
    let mut config = load_config();
    config.default_folder = Some(path);
    save_config(&config)
}

#[tauri::command]
fn clear_default_folder() -> Result<(), String> {
    let mut config = load_config();
    config.default_folder = None;
    save_config(&config)
}

fn main() {
    tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            load_folder,
            play_track,
            toggle_pause,
            stop,
            next_track,
            prev_track,
            set_volume,
            get_status,
            seek,
            seek_relative,
            get_default_folder,
            set_default_folder,
            clear_default_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
