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
    const whole = Math.floor(seconds);
    const mins = Math.floor(whole / 60);
    const secs = whole % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

// Like formatDuration, with tenths of a second (e.g. "1:23.4")
export function formatPreciseTime(seconds) {
    const tenths = Math.floor((seconds % 1) * 10 + 1e-6);
    return `${formatDuration(seconds)}.${tenths}`;
}

// Parse "s", "m:ss" or "h:mm:ss" into seconds (last part may be fractional); null if invalid
export function parseTime(text) {
    const parts = text.split(':');
    if (parts.length > 3) return null;
    const valid = parts.every((p, i) => (i === parts.length - 1 ? /^\d+(\.\d+)?$/ : /^\d+$/).test(p));
    if (!valid) return null;
    return parts.reduce((total, p) => total * 60 + Number(p), 0);
}
