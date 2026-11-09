// Shared application state managed by Tauri

use souvlaki::{MediaControls, MediaMetadata, MediaPlayback, MediaPosition};
use std::sync::Mutex;
use std::time::Duration;

use crate::metadata::MetadataMap;
use crate::player::AudioPlayer;

pub struct AppState {
    pub player: AudioPlayer,
    pub playlist: Mutex<Vec<String>>,
    pub current_index: Mutex<usize>,
    pub current_track: Mutex<Option<String>>,
    pub current_duration: Mutex<Option<u64>>,
    pub volume: Mutex<f32>,
    pub is_playing: Mutex<bool>,
    pub is_paused: Mutex<bool>,
    pub media_controls: Mutex<Option<MediaControls>>,
    // Loaded lazily from disk on first use, then kept in memory
    pub metadata_cache: Mutex<Option<MetadataMap>>,
}

impl AppState {
    pub fn new() -> Self {
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
            metadata_cache: Mutex::new(None),
        }
    }


    pub fn update_media_playback(&self, playing: bool, paused: bool) {
        if let Ok(mut controls) = self.media_controls.lock() {
            if let Some(ref mut mc) = *controls {
                let progress = if playing {
                    Some(MediaPosition(Duration::from_secs_f64(self.player.get_elapsed())))
                } else {
                    None
                };
                let playback = if !playing {
                    MediaPlayback::Stopped
                } else if paused {
                    MediaPlayback::Paused { progress }
                } else {
                    MediaPlayback::Playing { progress }
                };
                let _ = mc.set_playback(playback);
            }
        }
    }
    
    pub fn update_media_metadata(&self, title: &str, duration: Option<u64>) {
        if let Ok(mut controls) = self.media_controls.lock() {
            if let Some(ref mut mc) = *controls {
                let _ = mc.set_metadata(MediaMetadata {
                    title: Some(title),
                    artist: Some("VI Music"),
                    album: None,
                    cover_url: None,
                    duration: duration.map(Duration::from_secs),
                });
            }
        }
    }
}
