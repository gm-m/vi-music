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

// Parse "s", "m:ss" or "h:mm:ss" into seconds; returns null if invalid
export function parseTime(text) {
    const parts = text.split(':').map(p => (/^\d+$/.test(p) ? Number(p) : NaN));
    if (parts.length > 3 || parts.some(isNaN)) return null;
    return parts.reduce((total, p) => total * 60 + p, 0);
}
