// Utility functions

import { state } from './state.js';
import { invoke } from './tauri.js';

// Sync the backend playlist with the frontend state
export function syncBackendPlaylist() {
    invoke('set_playlist', { paths: state.playlist.map(t => t.path) }).catch(err => {
        console.error('Failed to sync backend playlist:', err);
    });
}

export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function formatDuration(seconds) {
    if (seconds === null || seconds === undefined) {
        return '--:--';
    }
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
}
