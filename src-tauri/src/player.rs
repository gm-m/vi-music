// Audio engine: a dedicated thread owning the rodio output, driven by AudioCommand messages

use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

// Symphonia imports for fast FLAC seeking
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::formats::{FormatOptions, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

#[derive(Clone)]
pub enum AudioCommand {
    Play(String, f32, f64),
    Pause,
    Resume,
    Stop,
    SetVolume(f32),
    Seek(f64),
    SetSpeed(f32),
    SetDevice(String), // Device name to switch to
}

struct PlaybackState {
    start_time: Option<Instant>,
    start_position: f64,
    is_paused: bool,
    pause_time: Option<Instant>,
    current_path: Option<String>,
    is_finished: bool,
    speed: f32,
}

impl PlaybackState {
    fn new() -> Self {
        Self {
            start_time: None,
            start_position: 0.0,
            is_paused: false,
            pause_time: None,
            current_path: None,
            is_finished: false,
            speed: 1.0,
        }
    }
    
    fn get_elapsed(&self) -> f64 {
        if let Some(start) = self.start_time {
            let speed = if self.speed <= 0.0 { 1.0 } else { self.speed as f64 };
            if self.is_paused {
                if let Some(pause) = self.pause_time {
                    return self.start_position + pause.duration_since(start).as_secs_f64() * speed;
                }
            }
            self.start_position + start.elapsed().as_secs_f64() * speed
        } else {
            0.0
        }
    }
}

// Custom symphonia source for fast seeking (FLAC, MP3, etc.)
struct SymphoniaSource {
    decoder: Box<dyn symphonia::core::codecs::Decoder>,
    format: Box<dyn symphonia::core::formats::FormatReader>,
    track_id: u32,
    sample_rate: u32,
    channels: u16,
    current_samples: Vec<i16>,
    sample_index: usize,
    total_samples: Option<u64>,
}

impl SymphoniaSource {
    fn new(path: &str, seek_secs: f64) -> Option<Self> {
        let file = std::fs::File::open(path).ok()?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());
        
        let path_buf = std::path::Path::new(path);
        let ext = path_buf.extension()?.to_str()?.to_lowercase();
        
        let mut hint = Hint::new();
        hint.with_extension(&ext);
        
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
        let total_samples = track.codec_params.n_frames;
        
        let mut decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &decoder_opts)
            .ok()?;
        
        // Seek if needed
        if seek_secs > 0.0 {
            let seek_ts = (seek_secs * sample_rate as f64) as u64;
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
            total_samples,
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

impl Iterator for SymphoniaSource {
    type Item = i16;
    
    fn next(&mut self) -> Option<Self::Item> {
        while self.sample_index >= self.current_samples.len() {
            if !self.decode_next_packet() {
                return None;
            }
        }
        
        let sample = self.current_samples[self.sample_index];
        self.sample_index += 1;
        Some(sample)
    }
}

impl rodio::Source for SymphoniaSource {
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
        if self.sample_rate == 0 {
            return None;
        }
        self.total_samples.map(|n| {
            std::time::Duration::from_secs(n / self.sample_rate as u64)
        })
    }
}

pub struct AudioPlayer {
    command_tx: Sender<AudioCommand>,
    playback_state: Arc<Mutex<PlaybackState>>,
}

impl AudioPlayer {
    pub fn new() -> Self {
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
            
            fn play_file(path: &str, volume: f32, speed: f32, seek_secs: f64, stream_handle: &rodio::OutputStreamHandle, start_paused: bool) -> Option<Sink> {
                let sink = Sink::try_new(stream_handle).ok()?;
                sink.set_volume(volume);
                sink.set_speed(speed);
                // Start paused so no audio plays until caller sets start_time
                sink.pause();
                
                // Try symphonia first for all formats (better seeking, handles embedded art)
                if let Some(source) = SymphoniaSource::new(path, seek_secs) {
                    sink.append(source);
                } else {
                    // Fallback to rodio decoder for formats symphonia doesn't support
                    let file = File::open(path).ok()?;
                    let source = Decoder::new(BufReader::new(file)).ok()?;
                    sink.append(source);
                    if seek_secs > 0.0 {
                        let _ = sink.try_seek(Duration::from_secs_f64(seek_secs));
                    }
                }
                // Only start playing if caller doesn't want it paused
                if !start_paused {
                    sink.play();
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
                            
                            let current_speed = state_clone.lock().unwrap().speed;
                            
                            // Try to play, recreating output stream if needed
                            let mut played = false;
                            if let Some(ref handle) = audio_output.as_ref().map(|(_, h)| h) {
                                if let Some(sink) = play_file(&path, volume, current_speed, skip_secs, handle, false) {
                                    current_sink = Some(sink);
                                    played = true;
                                }
                            }
                            
                            // If playback failed, try recreating the audio output (device may have changed)
                            if !played {
                                audio_output = create_output_for_device(&selected_device_name);
                                if let Some(ref handle) = audio_output.as_ref().map(|(_, h)| h) {
                                    if let Some(sink) = play_file(&path, volume, current_speed, skip_secs, handle, false) {
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
                                if state.is_paused && state.start_time.is_some() {
                                    // Position at pause time (accounts for speed and sub-second precision)
                                    state.start_position = state.get_elapsed();
                                    state.start_time = Some(Instant::now());
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
                            state.start_position = 0.0;
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
                            let current_elapsed = state.get_elapsed();
                            state.start_position = current_elapsed;
                            if state.start_time.is_some() {
                                state.start_time = Some(Instant::now());
                            }
                            if state.is_paused {
                                state.pause_time = Some(Instant::now());
                            }
                            state.speed = speed;
                        }
                        AudioCommand::Seek(position) => {
                            let state = state_clone.lock().unwrap();
                            let was_paused = state.is_paused;
                            let speed = state.speed;
                            if let Some(ref path) = state.current_path.clone() {
                                // Always recreate the sink for seeking since SymphoniaSource
                                // doesn't support rodio's try_seek. The recreate approach
                                // works reliably for all formats.
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
                                // Sink starts paused so we can set start_time before audio plays
                                let mut played = false;
                                if let Some(ref handle) = audio_output.as_ref().map(|(_, h)| h) {
                                    if let Some(sink) = play_file(&path, volume, speed, position, handle, true) {
                                        current_sink = Some(sink);
                                        played = true;
                                    }
                                }
                                
                                if !played {
                                    audio_output = create_output_for_device(&selected_device_name);
                                    if let Some(ref handle) = audio_output.as_ref().map(|(_, h)| h) {
                                        if let Some(sink) = play_file(&path, volume, speed, position, handle, true) {
                                            current_sink = Some(sink);
                                            played = true;
                                        }
                                    }
                                }
                                
                                if played {
                                    if was_paused {
                                        // Keep paused — sink is already paused from play_file
                                        let now = Instant::now();
                                        let mut state = state_clone.lock().unwrap();
                                        state.start_time = Some(now);
                                        state.start_position = position;
                                        state.is_paused = true;
                                        state.pause_time = Some(now);
                                        state.is_finished = false;
                                    } else {
                                        // Set start_time BEFORE unpausing so elapsed is accurate
                                        let mut state = state_clone.lock().unwrap();
                                        state.start_time = Some(Instant::now());
                                        state.start_position = position;
                                        state.is_paused = false;
                                        state.pause_time = None;
                                        state.is_finished = false;
                                        drop(state);
                                        // Now unpause — audio starts exactly when start_time is set
                                        if let Some(ref sink) = current_sink {
                                            sink.play();
                                        }
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
                            let speed = state.speed;
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
                                        if let Some(sink) = play_file(path, volume, speed, current_position, handle, false) {
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
    
    pub fn send(&self, cmd: AudioCommand) {
        let _ = self.command_tx.send(cmd);
    }
    
    pub fn get_elapsed(&self) -> f64 {
        self.playback_state.lock().unwrap().get_elapsed()
    }
    
    // Update the reported position immediately, so status polls made before the audio
    // thread has recreated the sink don't return the pre-seek position
    pub fn seek(&self, position: f64) {
        {
            let mut state = self.playback_state.lock().unwrap();
            if state.start_time.is_some() {
                let now = Instant::now();
                state.start_position = position;
                state.start_time = Some(now);
                if state.is_paused {
                    state.pause_time = Some(now);
                }
            }
        }
        self.send(AudioCommand::Seek(position));
    }
    
    pub fn is_finished(&self) -> bool {
        self.playback_state.lock().unwrap().is_finished
    }
    
    pub fn get_speed(&self) -> f32 {
        self.playback_state.lock().unwrap().speed
    }
}
