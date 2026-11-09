#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod config;
mod cues;
mod events;
mod library;
mod media;
mod metadata;
mod playback;
mod player;
mod playlists;
mod state;
mod storage;

use state::AppState;

fn main() {
    tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            library::load_folder,
            library::browse_folder,
            library::get_library_folders,
            library::add_library_folder,
            library::remove_library_folder,
            library::scan_library_folder,
            library::reveal_in_explorer,
            playback::play_track,
            playback::toggle_pause,
            playback::stop,
            playback::next_track,
            playback::prev_track,
            playback::set_volume,
            playback::set_speed,
            playback::get_status,
            playback::seek,
            playback::seek_relative,
            playback::set_playlist,
            playback::list_audio_devices,
            playback::set_audio_device,
            config::get_default_folder,
            config::set_default_folder,
            config::clear_default_folder,
            config::get_keybindings,
            config::save_keybindings,
            config::get_settings,
            config::save_settings,
            config::get_custom_theme,
            playlists::save_playlist,
            playlists::load_playlist,
            playlists::list_playlists,
            playlists::delete_playlist,
            playlists::rename_playlist,
            playlists::duplicate_playlist,
            playlists::create_playlist,
            playlists::add_tracks_to_playlist,
            cues::get_cues,
            cues::set_track_cues,
            cues::get_bookmarks,
            cues::save_bookmarks,
            cues::prune_missing,
            cues::export_cue_sheet,
            cues::import_cue_sheet,
            metadata::scan_metadata,
            metadata::get_artists,
            metadata::get_artist_tracks,
        ])
        .setup(|app| {
            media::setup_media_controls(app);
            events::spawn_status_emitter(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
