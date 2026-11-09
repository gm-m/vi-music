// Pushes playback status to the frontend, so it doesn't have to poll `get_status`

use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use crate::state::AppState;

const STATUS_EVENT: &str = "player-status";
const TRACK_FINISHED_EVENT: &str = "track-finished";

const TICK: Duration = Duration::from_millis(50);
// While playing, the position is re-sent at this interval; the frontend interpolates in between
const POSITION_INTERVAL: Duration = Duration::from_millis(250);

pub fn spawn_status_emitter(app: AppHandle) {
    thread::spawn(move || {
        let state = app.state::<AppState>();
        let mut last_key = None;
        let mut last_elapsed = 0.0;
        let mut last_emit = Instant::now();
        let mut was_finished = false;
        
        loop {
            thread::sleep(TICK);
            let status = state.status();
            
            // Any change other than the natural advance of the position is pushed immediately
            let key = (
                status.is_playing,
                status.is_paused,
                status.is_finished,
                status.current_index,
                status.duration,
                status.speed.to_bits(),
                status.volume.to_bits(),
            );
            let advancing = status.is_playing && !status.is_paused && !status.is_finished;
            let changed = last_key != Some(key)
                || (!advancing && (status.elapsed - last_elapsed).abs() > 0.01)
                || (advancing && last_emit.elapsed() >= POSITION_INTERVAL);
            if changed {
                let _ = app.emit_all(STATUS_EVENT, &status);
                last_key = Some(key);
                last_elapsed = status.elapsed;
                last_emit = Instant::now();
            }
            
            // Emitted once per finished track (the flag resets when a new track starts)
            if status.is_playing && status.is_finished && !was_finished {
                let _ = app.emit_all(TRACK_FINISHED_EVENT, ());
            }
            was_finished = status.is_finished;
        }
    });
}
