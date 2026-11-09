import { invoke } from './tauri.js';
import { state } from './state.js';
import { updateStatus, updateProgressDisplay } from './ui.js';
import { seekTo } from './playback.js';
import { formatDuration } from './utils.js';

// Pressing "previous cue" within this many seconds after a cue skips to the one before it
const PREV_CUE_GRACE_SECS = 2;

export async function loadCues() {
    try {
        state.cues = await invoke('get_cues');
    } catch (err) {
        console.error('Failed to load cues:', err);
        state.cues = {};
    }
}

function getPlayingTrack() {
    if (!state.isPlaying) {
        updateStatus('No track playing');
        return null;
    }
    return state.playlist[state.playingIndex] ?? null;
}

export function getTrackCues(path) {
    return state.cues[path] ?? [];
}

async function saveTrackCues(path, cues) {
    if (cues.length > 0) {
        state.cues[path] = cues;
    } else {
        delete state.cues[path];
    }
    updateProgressDisplay();
    try {
        await invoke('set_track_cues', { path, cues });
    } catch (err) {
        console.error('Failed to save cues:', err);
        updateStatus(`Failed to save cues: ${err}`);
    }
}

export async function addCue(position = state.elapsed) {
    const track = getPlayingTrack();
    if (!track) return;
    
    const pos = Math.max(0, Math.floor(state.duration ? Math.min(position, state.duration) : position));
    const cues = getTrackCues(track.path);
    if (cues.includes(pos)) {
        updateStatus(`Cue already exists at ${formatDuration(pos)}`);
        return;
    }
    
    const updated = [...cues, pos].sort((a, b) => a - b);
    await saveTrackCues(track.path, updated);
    updateStatus(`Cue ${updated.indexOf(pos) + 1}/${updated.length} added at ${formatDuration(pos)}`);
}

// Delete cue by 1-based number, or the cue nearest to the current position
export async function deleteCue(number = null) {
    const track = getPlayingTrack();
    if (!track) return;
    
    const cues = getTrackCues(track.path);
    if (cues.length === 0) {
        updateStatus('No cues for this track');
        return;
    }
    
    let index;
    if (number === null) {
        index = cues.reduce((best, c, i) =>
            Math.abs(c - state.elapsed) < Math.abs(cues[best] - state.elapsed) ? i : best, 0);
    } else {
        index = number - 1;
        if (index < 0 || index >= cues.length) {
            updateStatus(`Invalid cue number. Track has ${cues.length} cue${cues.length !== 1 ? 's' : ''}`);
            return;
        }
    }
    
    const removed = cues[index];
    await saveTrackCues(track.path, cues.filter((_, i) => i !== index));
    updateStatus(`Cue ${index + 1} at ${formatDuration(removed)} deleted`);
}

export async function clearCues() {
    const track = getPlayingTrack();
    if (!track) return;
    await saveTrackCues(track.path, []);
    updateStatus('Cues cleared for this track');
}

export function listCues() {
    const track = getPlayingTrack();
    if (!track) return;
    
    const cues = getTrackCues(track.path);
    if (cues.length === 0) {
        updateStatus('No cues for this track. Use :cue add [m:ss]');
        return;
    }
    updateStatus(`Cues: ${cues.map((c, i) => `${i + 1}:${formatDuration(c)}`).join(', ')}`);
}

async function jumpToCue(cues, target) {
    const pos = await seekTo(target);
    if (pos === undefined) return;
    state.elapsed = pos;
    updateProgressDisplay();
    updateStatus(`Cue ${cues.indexOf(target) + 1}/${cues.length} @ ${formatDuration(target)}`);
}

export async function jumpToNextCue(count = 1) {
    const track = getPlayingTrack();
    if (!track) return;
    
    const cues = getTrackCues(track.path);
    const ahead = cues.filter(c => c > state.elapsed);
    if (ahead.length === 0) {
        updateStatus(cues.length ? 'No next cue' : 'No cues for this track');
        return;
    }
    await jumpToCue(cues, ahead[Math.min(count, ahead.length) - 1]);
}

export async function jumpToPrevCue(count = 1) {
    const track = getPlayingTrack();
    if (!track) return;
    
    const cues = getTrackCues(track.path);
    const behind = cues.filter(c => c < state.elapsed - PREV_CUE_GRACE_SECS).reverse();
    if (behind.length === 0) {
        updateStatus(cues.length ? 'No previous cue' : 'No cues for this track');
        return;
    }
    await jumpToCue(cues, behind[Math.min(count, behind.length) - 1]);
}
