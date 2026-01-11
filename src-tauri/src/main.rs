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

// Symphonia imports for fast FLAC seeking
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::formats::{FormatOptions, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

#[derive(Serialize, Deserialize, Default)]
struct AppConfig {
    default_folder: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct SavedPlaylist {
    name: String,
    tracks: Vec<String>, // File paths
}

#[derive(Serialize, Deserialize, Clone)]
struct PlaylistInfo {
    name: String,
    track_count: usize,
}

fn get_config_path() -> Option<PathBuf> {
    dirs::config_dir().map(|p| p.join("vi-music").join("config.json"))
}

fn get_playlists_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|p| p.join("vi-music").join("playlists"))
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

// Custom FLAC source using symphonia for fast seeking
struct SymphoniaFlacSource {
    decoder: Box<dyn symphonia::core::codecs::Decoder>,
    format: Box<dyn symphonia::core::formats::FormatReader>,
    track_id: u32,
    sample_rate: u32,
    channels: u16,
    current_samples: Vec<i16>,
    sample_index: usize,
}

impl SymphoniaFlacSource {
    fn new(path: &str, seek_secs: u64) -> Option<Self> {
        let file = std::fs::File::open(path).ok()?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());
        
        let mut hint = Hint::new();
        hint.with_extension("flac");
        
        let format_opts = FormatOptions::default();
        let metadata_opts = MetadataOptions::default();
        let decoder_opts = DecoderOptions::default();
        
        let probed = symphonia::default::get_probe()
            .format(&hint, mss, &format_opts, &metadata_opts)
            .ok()?;
        
        let mut format = probed.format;
        
        let track = format.tracks()
            .iter()
            .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)?;
        
        let track_id = track.id;
        let sample_rate = track.codec_params.sample_rate.unwrap_or(44100);
        let channels = track.codec_params.channels.map(|c| c.count() as u16).unwrap_or(2);
        
        let mut decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &decoder_opts)
            .ok()?;
        
        // Seek if needed
        if seek_secs > 0 {
            let seek_ts = seek_secs * sample_rate as u64;
            let _ = format.seek(
                SeekMode::Accurate,
                SeekTo::TimeStamp { ts: seek_ts, track_id },
            );
            decoder.reset();
        }
        
        Some(Self {
            decoder,
            format,
            track_id,
            sample_rate,
            channels,
            current_samples: Vec::new(),
            sample_index: 0,
        })
    }
    
    fn decode_next_packet(&mut self) -> bool {
        loop {
            match self.format.next_packet() {
                Ok(packet) => {
                    if packet.track_id() != self.track_id {
                        continue;
                    }
                    
                    match self.decoder.decode(&packet) {
                        Ok(decoded) => {
                            let spec = *decoded.spec();
                            let duration = decoded.capacity() as u64;
                            
                            let mut sample_buf = SampleBuffer::<i16>::new(duration, spec);
                            sample_buf.copy_interleaved_ref(decoded);
                            
                            self.current_samples = sample_buf.samples().to_vec();
                            self.sample_index = 0;
                            return true;
                        }
                        Err(_) => continue,
                    }
                }
                Err(_) => return false,
            }
        }
    }
}

impl Iterator for SymphoniaFlacSource {
    type Item = i16;
    
    fn next(&mut self) -> Option<Self::Item> {
        if self.sample_index >= self.current_samples.len() {
            if !self.decode_next_packet() {
                return None;
            }
        }
        
        let sample = self.current_samples[self.sample_index];
        self.sample_index += 1;
        Some(sample)
    }
}

impl rodio::Source for SymphoniaFlacSource {
    fn current_frame_len(&self) -> Option<usize> {
        Some(self.current_samples.len() - self.sample_index)
    }
    
    fn channels(&self) -> u16 {
        self.channels
    }
    
    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }
    
    fn total_duration(&self) -> Option<std::time::Duration> {
        None
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
                use std::path::Path;
                
                let ext = Path::new(path).extension()?.to_str()?.to_lowercase();
                let sink = Sink::try_new(stream_handle).ok()?;
                sink.set_volume(volume);
                
                if ext == "flac" {
                    // FLAC: use custom symphonia source for fast seeking
                    let source = SymphoniaFlacSource::new(path, seek_secs)?;
                    sink.append(source);
                } else {
                    // MP3/WAV: use rodio decoder with try_seek
                    let file = File::open(path).ok()?;
                    let source = Decoder::new(BufReader::new(file)).ok()?;
                    sink.append(source);
                    if seek_secs > 0 {
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

#[derive(Serialize, Deserialize, Clone)]
struct FolderItem {
    name: String,
    path: String,
    is_folder: bool,
    track_count: usize,
    duration: Option<u64>,
}

#[derive(Serialize, Deserialize)]
struct FolderContents {
    path: String,
    parent: Option<String>,
    items: Vec<FolderItem>,
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
fn browse_folder(path: String, root_path: String) -> Result<FolderContents, String> {
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
    
    if let Ok(entries) = std::fs::read_dir(&path) {
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

fn count_audio_files(path: &PathBuf) -> usize {
    WalkDir::new(path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file() && is_audio_file(&e.path().to_path_buf()))
        .count()
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

#[tauri::command]
fn save_playlist(name: String, state: State<AppState>) -> Result<(), String> {
    let playlists_dir = get_playlists_dir().ok_or("Could not determine playlists directory")?;
    fs::create_dir_all(&playlists_dir).map_err(|e| e.to_string())?;
    
    let playlist = state.playlist.lock().unwrap();
    let saved = SavedPlaylist {
        name: name.clone(),
        tracks: playlist.clone(),
    };
    
    let filename = format!("{}.json", sanitize_filename(&name));
    let path = playlists_dir.join(&filename);
    let content = serde_json::to_string_pretty(&saved).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
fn load_playlist(name: String, state: State<AppState>) -> Result<Vec<TrackInfo>, String> {
    let playlists_dir = get_playlists_dir().ok_or("Could not determine playlists directory")?;
    let filename = format!("{}.json", sanitize_filename(&name));
    let path = playlists_dir.join(&filename);
    
    let content = fs::read_to_string(&path).map_err(|_| "Playlist not found")?;
    let saved: SavedPlaylist = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    
    // Filter out tracks that no longer exist
    let valid_tracks: Vec<String> = saved.tracks
        .into_iter()
        .filter(|p| PathBuf::from(p).exists())
        .collect();
    
    let track_infos: Vec<TrackInfo> = valid_tracks
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
    
    *state.playlist.lock().unwrap() = valid_tracks;
    *state.current_index.lock().unwrap() = 0;
    
    Ok(track_infos)
}

#[tauri::command]
fn list_playlists() -> Result<Vec<PlaylistInfo>, String> {
    let playlists_dir = get_playlists_dir().ok_or("Could not determine playlists directory")?;
    
    if !playlists_dir.exists() {
        return Ok(Vec::new());
    }
    
    let mut playlists = Vec::new();
    
    if let Ok(entries) = fs::read_dir(&playlists_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().map(|e| e == "json").unwrap_or(false) {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(saved) = serde_json::from_str::<SavedPlaylist>(&content) {
                        playlists.push(PlaylistInfo {
                            name: saved.name,
                            track_count: saved.tracks.len(),
                        });
                    }
                }
            }
        }
    }
    
    playlists.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(playlists)
}

#[tauri::command]
fn delete_playlist(name: String) -> Result<(), String> {
    let playlists_dir = get_playlists_dir().ok_or("Could not determine playlists directory")?;
    let filename = format!("{}.json", sanitize_filename(&name));
    let path = playlists_dir.join(&filename);
    
    fs::remove_file(&path).map_err(|_| "Failed to delete playlist")?;
    Ok(())
}

#[tauri::command]
fn create_playlist(name: String) -> Result<(), String> {
    let playlists_dir = get_playlists_dir().ok_or("Could not determine playlists directory")?;
    fs::create_dir_all(&playlists_dir).map_err(|e| e.to_string())?;
    
    let filename = format!("{}.json", sanitize_filename(&name));
    let path = playlists_dir.join(&filename);
    
    if path.exists() {
        return Err("Playlist already exists".to_string());
    }
    
    let saved = SavedPlaylist {
        name,
        tracks: Vec::new(),
    };
    
    let content = serde_json::to_string_pretty(&saved).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
fn add_tracks_to_playlist(name: String, tracks: Vec<String>) -> Result<usize, String> {
    let playlists_dir = get_playlists_dir().ok_or("Could not determine playlists directory")?;
    let filename = format!("{}.json", sanitize_filename(&name));
    let path = playlists_dir.join(&filename);
    
    let mut saved: SavedPlaylist = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        // Create new playlist if it doesn't exist
        fs::create_dir_all(&playlists_dir).map_err(|e| e.to_string())?;
        SavedPlaylist {
            name: name.clone(),
            tracks: Vec::new(),
        }
    };
    
    // Add tracks that aren't already in the playlist
    let mut added = 0;
    for track in tracks {
        if !saved.tracks.contains(&track) {
            saved.tracks.push(track);
            added += 1;
        }
    }
    
    let content = serde_json::to_string_pretty(&saved).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    
    Ok(added)
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' { c } else { '_' })
        .collect()
}

fn main() {
    tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            load_folder,
            browse_folder,
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
            save_playlist,
            load_playlist,
            list_playlists,
            delete_playlist,
            create_playlist,
            add_tracks_to_playlist,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
