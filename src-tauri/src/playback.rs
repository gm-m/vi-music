// Playback commands: transport, volume/speed, seeking, status and output devices

use serde::Serialize;
use tauri::State;

use crate::library::TrackInfo;
use crate::player::AudioCommand;
use crate::state::AppState;

#[derive(Serialize, Clone)]
pub struct PlayerStatus {
    pub is_playing: bool,
    pub is_paused: bool,
    pub is_finished: bool,
    pub current_track: Option<String>,
    pub current_index: usize,
    pub volume: f32,
    pub speed: f32,
    pub playlist_length: usize,
    pub elapsed: f64,
    pub duration: Option<u64>,
}

impl AppState {
    pub fn status(&self) -> PlayerStatus {
        PlayerStatus {
            is_playing: *self.is_playing.lock().unwrap(),
            is_paused: *self.is_paused.lock().unwrap(),
            is_finished: self.player.is_finished(),
            current_track: self.current_track.lock().unwrap().clone(),
            current_index: *self.current_index.lock().unwrap(),
            volume: *self.volume.lock().unwrap(),
            speed: self.player.get_speed(),
            playlist_length: self.playlist.lock().unwrap().len(),
            elapsed: self.player.get_elapsed(),
            duration: *self.current_duration.lock().unwrap(),
        }
    }
    
    // Start playing the playlist track at `index` from `skip_secs`
    fn start_track(&self, index: usize, skip_secs: f64) -> Result<TrackInfo, String> {
        let path = self.playlist.lock().unwrap().get(index).cloned().ok_or("Invalid track index")?;
        let track = TrackInfo::from_path(&path, index);
        *self.current_duration.lock().unwrap() = track.duration;
        
        let volume = *self.volume.lock().unwrap();
        self.player.send(AudioCommand::Play(path, volume, skip_secs.max(0.0)));
        
        *self.current_index.lock().unwrap() = index;
        *self.is_playing.lock().unwrap() = true;
        *self.is_paused.lock().unwrap() = false;
        *self.current_track.lock().unwrap() = Some(track.name.clone());
        
        // Update media controls
        self.update_media_metadata(&track.name, track.duration);
        self.update_media_playback(true, false);
        Ok(track)
    }
    
    // Start the track at `offset` from the current one, wrapping around the playlist
    fn start_relative(&self, offset: isize) -> Result<TrackInfo, String> {
        let len = self.playlist.lock().unwrap().len() as isize;
        if len == 0 {
            return Err("Playlist is empty".to_string());
        }
        let current = *self.current_index.lock().unwrap() as isize;
        self.start_track((current + offset).rem_euclid(len) as usize, 0.0)
    }
    
    fn clamp_position(&self, position: f64) -> f64 {
        let max_pos = self.current_duration.lock().unwrap().map_or(f64::MAX, |d| d as f64);
        position.max(0.0).min(max_pos)
    }
    
    fn ensure_playing(&self) -> Result<(), String> {
        if *self.is_playing.lock().unwrap() {
            Ok(())
        } else {
            Err("No track is playing".to_string())
        }
    }
}

#[tauri::command]
pub fn play_track(index: usize, skip_secs: Option<f64>, state: State<AppState>) -> Result<TrackInfo, String> {
    state.start_track(index, skip_secs.unwrap_or(0.0))
}

#[tauri::command]
pub fn next_track(state: State<AppState>) -> Result<TrackInfo, String> {
    state.start_relative(1)
}

#[tauri::command]
pub fn prev_track(state: State<AppState>) -> Result<TrackInfo, String> {
    state.start_relative(-1)
}

#[tauri::command]
pub fn toggle_pause(state: State<AppState>) -> Result<bool, String> {
    state.ensure_playing()?;
    
    let mut is_paused = state.is_paused.lock().unwrap();
    *is_paused = !*is_paused;
    let paused = *is_paused;
    drop(is_paused);
    
    state.player.send(if paused { AudioCommand::Pause } else { AudioCommand::Resume });
    state.update_media_playback(true, paused);
    Ok(paused)
}

#[tauri::command]
pub fn stop(state: State<AppState>) -> Result<(), String> {
    state.player.send(AudioCommand::Stop);
    *state.is_playing.lock().unwrap() = false;
    *state.is_paused.lock().unwrap() = false;
    *state.current_track.lock().unwrap() = None;
    state.update_media_playback(false, false);
    Ok(())
}

#[tauri::command]
pub fn set_volume(volume: f32, state: State<AppState>) -> Result<f32, String> {
    let clamped = volume.clamp(0.0, 1.0);
    *state.volume.lock().unwrap() = clamped;
    state.player.send(AudioCommand::SetVolume(clamped));
    Ok(clamped)
}

#[tauri::command]
pub fn set_speed(speed: f32, state: State<AppState>) -> Result<f32, String> {
    let clamped = speed.clamp(0.25, 3.0);
    state.player.send(AudioCommand::SetSpeed(clamped));
    Ok(clamped)
}

#[tauri::command]
pub fn get_status(state: State<AppState>) -> PlayerStatus {
    state.status()
}

#[tauri::command]
pub fn seek(position: f64, state: State<AppState>) -> Result<f64, String> {
    state.ensure_playing()?;
    let clamped = state.clamp_position(position);
    state.player.seek(clamped);
    Ok(clamped)
}

#[tauri::command]
pub fn seek_relative(delta: f64, state: State<AppState>) -> Result<f64, String> {
    state.ensure_playing()?;
    let new_pos = state.clamp_position(state.player.get_elapsed() + delta);
    state.player.seek(new_pos);
    Ok(new_pos)
}

#[tauri::command]
pub fn set_playlist(paths: Vec<String>, state: State<AppState>) {
    *state.playlist.lock().unwrap() = paths;
}

#[tauri::command]
pub fn list_audio_devices() -> Vec<String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    
    cpal::default_host()
        .output_devices()
        .map(|devices| devices.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub fn set_audio_device(device_name: String, state: State<AppState>) {
    state.player.send(AudioCommand::SetDevice(device_name));
}
