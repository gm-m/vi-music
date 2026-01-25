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
use tauri::{Manager, State};
use walkdir::WalkDir;
use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, PlatformConfig};

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
    SetSpeed(f32),
    SetDevice(String), // Device name to switch to
}

struct PlaybackState {
    start_time: Option<Instant>,
    start_position: u64,
    is_paused: bool,
    pause_time: Option<Instant>,
    current_path: Option<String>,
    duration: Option<u64>,
    is_finished: bool,
    speed: f32,
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
            speed: 1.0,
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
    pub command_tx: Sender<AudioCommand>,
    playback_state: Arc<Mutex<PlaybackState>>,
}

impl AudioPlayer {
    fn new() -> Self {
        let (tx, rx) = channel::<AudioCommand>();
        let playback_state = Arc::new(Mutex::new(PlaybackState::new()));
        let state_clone = playback_state.clone();
        
        thread::spawn(move || {
            use rodio::{Decoder, OutputStream, Sink};
            use cpal::traits::{HostTrait, DeviceTrait};
            use std::fs::File;
            use std::io::BufReader;
            use std::time::Duration;
            
            // Store stream and handle - will be recreated on device change
            let mut audio_output: Option<(OutputStream, rodio::OutputStreamHandle)> = 
                OutputStream::try_default().ok();
            let mut current_sink: Option<Sink> = None;
            let mut selected_device_name: Option<String> = None;
            
            // Helper to create output for a specific device or default
            fn create_output_for_device(device_name: &Option<String>) -> Option<(OutputStream, rodio::OutputStreamHandle)> {
                if let Some(ref name) = device_name {
                    let host = cpal::default_host();
                    if let Ok(devices) = host.output_devices() {
                        for device in devices {
                            if let Ok(dev_name) = device.name() {
                                if dev_name == *name {
                                    return OutputStream::try_from_device(&device).ok();
                                }
                            }
                        }
                    }
                }
                // Fall back to default
                OutputStream::try_default().ok()
            }
            
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
                            
                            // Try to play, recreating output stream if needed
                            let mut played = false;
                            if let Some(ref handle) = audio_output.as_ref().map(|(_, h)| h) {
                                if let Some(sink) = play_file(&path, volume, skip_secs, handle) {
                                    current_sink = Some(sink);
                                    played = true;
                                }
                            }
                            
                            // If playback failed, try recreating the audio output (device may have changed)
                            if !played {
                                audio_output = create_output_for_device(&selected_device_name);
                                if let Some(ref handle) = audio_output.as_ref().map(|(_, h)| h) {
                                    if let Some(sink) = play_file(&path, volume, skip_secs, handle) {
                                        current_sink = Some(sink);
                                        played = true;
                                    }
                                }
                            }
                            
                            if played {
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
                        AudioCommand::SetSpeed(speed) => {
                            if let Some(ref sink) = current_sink {
                                sink.set_speed(speed);
                            }
                            let mut state = state_clone.lock().unwrap();
                            state.speed = speed;
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
                                    
                                    // Try with current output, recreate if needed
                                    let mut played = false;
                                    if let Some(ref handle) = audio_output.as_ref().map(|(_, h)| h) {
                                        if let Some(sink) = play_file(&path, volume, position, handle) {
                                            current_sink = Some(sink);
                                            played = true;
                                        }
                                    }
                                    
                                    if !played {
                                        audio_output = create_output_for_device(&selected_device_name);
                                        if let Some(ref handle) = audio_output.as_ref().map(|(_, h)| h) {
                                            if let Some(sink) = play_file(&path, volume, position, handle) {
                                                current_sink = Some(sink);
                                                played = true;
                                            }
                                        }
                                    }
                                    
                                    if played {
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
                        AudioCommand::SetDevice(device_name) => {
                            // Store the selected device name
                            selected_device_name = if device_name.is_empty() { None } else { Some(device_name) };
                            
                            // Get current playback state before switching
                            let state = state_clone.lock().unwrap();
                            let was_playing = state.start_time.is_some() && !state.is_paused;
                            let current_path = state.current_path.clone();
                            let current_position = state.get_elapsed();
                            drop(state);
                            
                            // Get current volume before stopping
                            let volume = if let Some(ref sink) = current_sink {
                                sink.volume()
                            } else {
                                1.0
                            };
                            
                            // Stop current playback
                            if let Some(sink) = current_sink.take() {
                                sink.stop();
                            }
                            
                            // Recreate audio output with new device
                            audio_output = create_output_for_device(&selected_device_name);
                            
                            // Resume playback if was playing
                            if was_playing {
                                if let Some(ref path) = current_path {
                                    if let Some(ref handle) = audio_output.as_ref().map(|(_, h)| h) {
                                        if let Some(sink) = play_file(path, volume, current_position, handle) {
                                            current_sink = Some(sink);
                                            
                                            let mut state = state_clone.lock().unwrap();
                                            state.start_time = Some(Instant::now());
                                            state.start_position = current_position;
                                            state.is_paused = false;
                                            state.pause_time = None;
                                        }
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
    
    fn get_speed(&self) -> f32 {
        self.playback_state.lock().unwrap().speed
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
    media_controls: Mutex<Option<MediaControls>>,
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
            media_controls: Mutex::new(None),
        }
    }
    
    fn update_media_playback(&self, playing: bool, paused: bool) {
        if let Ok(mut controls) = self.media_controls.lock() {
            if let Some(ref mut mc) = *controls {
                let playback = if !playing {
                    MediaPlayback::Stopped
                } else if paused {
                    MediaPlayback::Paused { progress: None }
                } else {
                    MediaPlayback::Playing { progress: None }
                };
                let _ = mc.set_playback(playback);
            }
        }
    }
    
    fn update_media_metadata(&self, title: &str, duration: Option<u64>) {
        if let Ok(mut controls) = self.media_controls.lock() {
            if let Some(ref mut mc) = *controls {
                let _ = mc.set_metadata(MediaMetadata {
                    title: Some(title),
                    artist: Some("VI Music"),
                    album: None,
                    cover_url: None,
                    duration: duration.map(|d| std::time::Duration::from_secs(d)),
                });
            }
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
    speed: f32,
    playlist_length: usize,
    elapsed: u64,
    duration: Option<u64>,
}

fn is_audio_file(path: &PathBuf) -> bool {
    if let Some(ext) = path.extension() {
        let ext = ext.to_string_lossy().to_lowercase();
        matches!(ext.as_str(), "mp3" | "wav" | "flac" | "ogg" | "m4a" | "aif" | "aiff")
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
fn list_audio_devices() -> Vec<String> {
    use cpal::traits::{HostTrait, DeviceTrait};
    
    let host = cpal::default_host();
    let mut devices = Vec::new();
    
    if let Ok(output_devices) = host.output_devices() {
        for device in output_devices {
            if let Ok(name) = device.name() {
                devices.push(name);
            }
        }
    }
    
    devices
}

#[tauri::command]
fn set_audio_device(device_name: String, state: State<AppState>) {
    state.player.send(AudioCommand::SetDevice(device_name));
}

#[tauri::command]
fn play_track(index: usize, skip_secs: Option<u64>, state: State<AppState>) -> Result<TrackInfo, String> {
    let playlist = state.playlist.lock().unwrap();
    
    if index >= playlist.len() {
        return Err("Invalid track index".to_string());
    }
    
    let path = playlist[index].clone();
    drop(playlist);
    
    let duration = get_audio_duration(&path);
    *state.current_duration.lock().unwrap() = duration;
    
    let volume = *state.volume.lock().unwrap();
    let skip = skip_secs.unwrap_or(0);
    state.player.send(AudioCommand::Play(path.clone(), volume, skip));
    
    *state.current_index.lock().unwrap() = index;
    *state.is_playing.lock().unwrap() = true;
    *state.is_paused.lock().unwrap() = false;
    
    let name = PathBuf::from(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    
    *state.current_track.lock().unwrap() = Some(name.clone());
    
    // Update media controls
    state.update_media_metadata(&name, duration);
    state.update_media_playback(true, false);
    
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
        drop(is_paused);
        state.update_media_playback(true, false);
        Ok(false)
    } else {
        state.player.send(AudioCommand::Pause);
        *is_paused = true;
        drop(is_paused);
        state.update_media_playback(true, true);
        Ok(true)
    }
}

#[tauri::command]
fn stop(state: State<AppState>) -> Result<(), String> {
    state.player.send(AudioCommand::Stop);
    *state.is_playing.lock().unwrap() = false;
    *state.is_paused.lock().unwrap() = false;
    *state.current_track.lock().unwrap() = None;
    state.update_media_playback(false, false);
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
    
    // Update media controls
    state.update_media_metadata(&name, duration);
    state.update_media_playback(true, false);
    
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
    
    // Update media controls
    state.update_media_metadata(&name, duration);
    state.update_media_playback(true, false);
    
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
fn set_speed(speed: f32, state: State<AppState>) -> Result<f32, String> {
    let clamped = speed.clamp(0.25, 3.0);
    state.player.send(AudioCommand::SetSpeed(clamped));
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
        speed: state.player.get_speed(),
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
fn rename_playlist(old_name: String, new_name: String) -> Result<(), String> {
    let playlists_dir = get_playlists_dir().ok_or("Could not determine playlists directory")?;
    
    let old_filename = format!("{}.json", sanitize_filename(&old_name));
    let new_filename = format!("{}.json", sanitize_filename(&new_name));
    let old_path = playlists_dir.join(&old_filename);
    let new_path = playlists_dir.join(&new_filename);
    
    if !old_path.exists() {
        return Err(format!("Playlist '{}' not found", old_name));
    }
    
    if new_path.exists() {
        return Err(format!("Playlist '{}' already exists", new_name));
    }
    
    // Read the playlist, update the name, and save to new file
    let content = fs::read_to_string(&old_path).map_err(|e| e.to_string())?;
    let mut playlist: SavedPlaylist = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    playlist.name = new_name;
    
    let new_content = serde_json::to_string_pretty(&playlist).map_err(|e| e.to_string())?;
    fs::write(&new_path, new_content).map_err(|e| e.to_string())?;
    fs::remove_file(&old_path).map_err(|e| e.to_string())?;
    
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

fn get_config_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|p| p.join("vi-music"))
}

#[tauri::command]
fn get_keybindings() -> Result<String, String> {
    let config_dir = get_config_dir().ok_or("Could not determine config directory")?;
    let path = config_dir.join("keybindings.json");
    
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok("{}".to_string())
    }
}

#[tauri::command]
fn save_keybindings(keybindings: String) -> Result<(), String> {
    let config_dir = get_config_dir().ok_or("Could not determine config directory")?;
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    
    let path = config_dir.join("keybindings.json");
    fs::write(&path, keybindings).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_settings() -> Result<String, String> {
    let config_dir = get_config_dir().ok_or("Could not determine config directory")?;
    let path = config_dir.join("settings.json");
    
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok("{}".to_string())
    }
}

#[tauri::command]
fn save_settings(settings: String) -> Result<(), String> {
    let config_dir = get_config_dir().ok_or("Could not determine config directory")?;
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    
    let path = config_dir.join("settings.json");
    fs::write(&path, settings).map_err(|e| e.to_string())?;
    Ok(())
}

// Library folder management
#[tauri::command]
fn get_library_folders() -> Result<Vec<String>, String> {
    let config_dir = get_config_dir().ok_or("Could not determine config directory")?;
    let path = config_dir.join("library_folders.json");
    
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        Ok(Vec::new())
    }
}

#[tauri::command]
fn add_library_folder(folder: String) -> Result<Vec<String>, String> {
    let config_dir = get_config_dir().ok_or("Could not determine config directory")?;
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    
    let path = config_dir.join("library_folders.json");
    let mut folders: Vec<String> = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Vec::new()
    };
    
    if !folders.contains(&folder) {
        folders.push(folder);
        let content = serde_json::to_string_pretty(&folders).map_err(|e| e.to_string())?;
        fs::write(&path, content).map_err(|e| e.to_string())?;
    }
    
    Ok(folders)
}

#[tauri::command]
fn remove_library_folder(folder: String) -> Result<Vec<String>, String> {
    let config_dir = get_config_dir().ok_or("Could not determine config directory")?;
    let path = config_dir.join("library_folders.json");
    
    if !path.exists() {
        return Ok(Vec::new());
    }
    
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut folders: Vec<String> = serde_json::from_str(&content).unwrap_or_default();
    folders.retain(|f| f != &folder);
    
    let content = serde_json::to_string_pretty(&folders).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    
    Ok(folders)
}

#[tauri::command]
fn scan_library_folder(folder: String) -> Result<Vec<TrackInfo>, String> {
    let path = PathBuf::from(&folder);
    if !path.exists() || !path.is_dir() {
        return Err(format!("Folder not found: {}", folder));
    }
    
    let mut tracks = Vec::new();
    scan_folder_recursive(&path, &mut tracks);
    
    tracks.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(tracks)
}

#[tauri::command]
fn set_playlist(paths: Vec<String>, state: State<AppState>) {
    let mut playlist = state.playlist.lock().unwrap();
    *playlist = paths;
}

fn scan_folder_recursive(dir: &PathBuf, tracks: &mut Vec<TrackInfo>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_dir() {
                scan_folder_recursive(&path, tracks);
            } else if let Some(ext) = path.extension() {
                let ext_lower = ext.to_string_lossy().to_lowercase();
                if ext_lower == "mp3" || ext_lower == "flac" || ext_lower == "wav" || ext_lower == "ogg" || ext_lower == "m4a" || ext_lower == "aif" || ext_lower == "aiff" {
                    if let Some(name) = path.file_name() {
                        let path_str = path.to_string_lossy().to_string();
                        let duration = get_audio_duration(&path_str);
                        tracks.push(TrackInfo {
                            name: name.to_string_lossy().to_string(),
                            path: path_str,
                            index: 0, // Will be set after sorting
                            duration,
                        });
                    }
                }
            }
        }
    }
}

fn main() {
    let app_state = AppState::new();
    
    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            load_folder,
            browse_folder,
            play_track,
            toggle_pause,
            stop,
            next_track,
            prev_track,
            set_volume,
            set_speed,
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
            rename_playlist,
            create_playlist,
            add_tracks_to_playlist,
            get_keybindings,
            save_keybindings,
            get_settings,
            save_settings,
            get_library_folders,
            add_library_folder,
            remove_library_folder,
            scan_library_folder,
            set_playlist,
            list_audio_devices,
            set_audio_device,
        ])
        .setup(|app| {
            // Initialize media controls
            let window = app.get_window("main").expect("main window not found");
            
            #[cfg(target_os = "windows")]
            let hwnd = {
                let hwnd = window.hwnd().expect("failed to get window handle");
                Some(hwnd.0 as *mut std::ffi::c_void)
            };
            
            #[cfg(not(target_os = "windows"))]
            let hwnd: Option<*mut std::ffi::c_void> = None;
            
            let config = PlatformConfig {
                dbus_name: "vi_music",
                display_name: "VI Music",
                hwnd,
            };
            
            match MediaControls::new(config) {
                Ok(mut controls) => {
                    let state = app.state::<AppState>();
                    let app_handle = app.handle();
                    
                    // Set up event handler for media control events
                    let _ = controls.attach(move |event: MediaControlEvent| {
                        match event {
                            MediaControlEvent::Play => {
                                let _ = app_handle.emit_all("media-control", "play");
                            }
                            MediaControlEvent::Pause => {
                                let _ = app_handle.emit_all("media-control", "pause");
                            }
                            MediaControlEvent::Toggle => {
                                let _ = app_handle.emit_all("media-control", "toggle");
                            }
                            MediaControlEvent::Next => {
                                let _ = app_handle.emit_all("media-control", "next");
                            }
                            MediaControlEvent::Previous => {
                                let _ = app_handle.emit_all("media-control", "prev");
                            }
                            MediaControlEvent::Stop => {
                                let _ = app_handle.emit_all("media-control", "stop");
                            }
                            _ => {}
                        }
                    });
                    
                    // Store controls in app state
                    *state.media_controls.lock().unwrap() = Some(controls);
                }
                Err(_) => {}
            }
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
