// System media controls (SMTC / MPRIS / Now Playing) integration

use serde::Serialize;
use souvlaki::{MediaControlEvent, MediaControls, MediaPosition, PlatformConfig, SeekDirection};
use tauri::Manager;

use crate::state::AppState;

#[derive(Serialize, Clone)]
struct MediaControlPayload {
    action: String,
    position: Option<f64>,
    delta: Option<i64>,
}

pub fn setup_media_controls(app: &tauri::App) {
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
                        let _ = app_handle.emit_all("media-control", MediaControlPayload {
                            action: "play".to_string(),
                            position: None,
                            delta: None,
                        });
                    }
                    MediaControlEvent::Pause => {
                        let _ = app_handle.emit_all("media-control", MediaControlPayload {
                            action: "pause".to_string(),
                            position: None,
                            delta: None,
                        });
                    }
                    MediaControlEvent::Toggle => {
                        let _ = app_handle.emit_all("media-control", MediaControlPayload {
                            action: "toggle".to_string(),
                            position: None,
                            delta: None,
                        });
                    }
                    MediaControlEvent::Next => {
                        let _ = app_handle.emit_all("media-control", MediaControlPayload {
                            action: "next".to_string(),
                            position: None,
                            delta: None,
                        });
                    }
                    MediaControlEvent::Previous => {
                        let _ = app_handle.emit_all("media-control", MediaControlPayload {
                            action: "prev".to_string(),
                            position: None,
                            delta: None,
                        });
                    }
                    MediaControlEvent::Stop => {
                        let _ = app_handle.emit_all("media-control", MediaControlPayload {
                            action: "stop".to_string(),
                            position: None,
                            delta: None,
                        });
                    }
                    MediaControlEvent::SetPosition(MediaPosition(position)) => {
                        let _ = app_handle.emit_all("media-control", MediaControlPayload {
                            action: "setPosition".to_string(),
                            position: Some(position.as_secs_f64()),
                            delta: None,
                        });
                    }
                    MediaControlEvent::SeekBy(direction, amount) => {
                        let seconds = amount.as_secs() as i64;
                        let delta = match direction {
                            SeekDirection::Forward => seconds,
                            SeekDirection::Backward => -seconds,
                        };
                        let _ = app_handle.emit_all("media-control", MediaControlPayload {
                            action: "seekBy".to_string(),
                            position: None,
                            delta: Some(delta),
                        });
                    }
                    MediaControlEvent::Seek(direction) => {
                        let action = match direction {
                            SeekDirection::Forward => "seekForward",
                            SeekDirection::Backward => "seekBackward",
                        };
                        let _ = app_handle.emit_all("media-control", MediaControlPayload {
                            action: action.to_string(),
                            position: None,
                            delta: None,
                        });
                    }
                    _ => {}
                }
            });
            
            // Store controls in app state
            *state.media_controls.lock().unwrap() = Some(controls);
        }
        Err(_) => {}
    }
}
