#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::thread;
use tauri::State;
use walkdir::WalkDir;

#[derive(Clone)]
enum AudioCommand {
    Play(String, f32),
    Pause,
    Resume,
    Stop,
    SetVolume(f32),
}

struct AudioPlayer {
    command_tx: Sender<AudioCommand>,
}

impl AudioPlayer {
    fn new() -> Self {
        let (tx, rx) = channel::<AudioCommand>();
        
        thread::spawn(move || {
            use rodio::{Decoder, OutputStream, Sink};
            use std::fs::File;
            use std::io::BufReader;
            
            let (_stream, stream_handle) = OutputStream::try_default().unwrap();
            let mut current_sink: Option<Sink> = None;
            
            loop {
                if let Ok(cmd) = rx.recv() {
                    match cmd {
                        AudioCommand::Play(path, volume) => {
                            if let Some(sink) = current_sink.take() {
                                sink.stop();
                            }
                            if let Ok(file) = File::open(&path) {
                                if let Ok(source) = Decoder::new(BufReader::new(file)) {
                                    let sink = Sink::try_new(&stream_handle).unwrap();
                                    sink.set_volume(volume);
                                    sink.append(source);
                                    current_sink = Some(sink);
                                }
                            }
                        }
                        AudioCommand::Pause => {
                            if let Some(ref sink) = current_sink {
                                sink.pause();
                            }
                        }
                        AudioCommand::Resume => {
                            if let Some(ref sink) = current_sink {
                                sink.play();
                            }
                        }
                        AudioCommand::Stop => {
                            if let Some(sink) = current_sink.take() {
                                sink.stop();
                            }
                        }
                        AudioCommand::SetVolume(vol) => {
                            if let Some(ref sink) = current_sink {
                                sink.set_volume(vol);
                            }
                        }
                    }
                }
            }
        });
        
        Self { command_tx: tx }
    }
    
    fn send(&self, cmd: AudioCommand) {
        let _ = self.command_tx.send(cmd);
    }
}

struct AppState {
    player: AudioPlayer,
    playlist: Mutex<Vec<String>>,
    current_index: Mutex<usize>,
    current_track: Mutex<Option<String>>,
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
    current_track: Option<String>,
    current_index: usize,
    volume: f32,
    playlist_length: usize,
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
    
    let volume = *state.volume.lock().unwrap();
    state.player.send(AudioCommand::Play(path.clone(), volume));
    
    *state.current_index.lock().unwrap() = index;
    *state.is_playing.lock().unwrap() = true;
    *state.is_paused.lock().unwrap() = false;
    
    let name = PathBuf::from(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    
    *state.current_track.lock().unwrap() = Some(name.clone());
    
    let duration = get_audio_duration(&path);
    
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
    
    let volume = *state.volume.lock().unwrap();
    state.player.send(AudioCommand::Play(path.clone(), volume));
    
    *state.current_index.lock().unwrap() = next_index;
    *state.is_playing.lock().unwrap() = true;
    *state.is_paused.lock().unwrap() = false;
    
    let name = PathBuf::from(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    
    *state.current_track.lock().unwrap() = Some(name.clone());
    
    let duration = get_audio_duration(&path);
    
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
    
    let volume = *state.volume.lock().unwrap();
    state.player.send(AudioCommand::Play(path.clone(), volume));
    
    *state.current_index.lock().unwrap() = prev_index;
    *state.is_playing.lock().unwrap() = true;
    *state.is_paused.lock().unwrap() = false;
    
    let name = PathBuf::from(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    
    *state.current_track.lock().unwrap() = Some(name.clone());
    
    let duration = get_audio_duration(&path);
    
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
        current_track: state.current_track.lock().unwrap().clone(),
        current_index: *state.current_index.lock().unwrap(),
        volume: *state.volume.lock().unwrap(),
        playlist_length: state.playlist.lock().unwrap().len(),
    }
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
