import { state } from './state.js';
import { formatDuration } from './utils.js';
import { updateStatus, updateSleepTimerDisplay, updateLoopDisplay } from './ui.js';
import { seekTo, playTrack, stop, stopLoopMonitor, startLoopMonitor } from './playback.js';

// Sleep Timer
export function setSleepTimer(minutes) {
    clearSleepTimer();
    
    if (minutes <= 0) {
        updateStatus('Sleep timer cleared');
        return;
    }
    
    state.sleepTimerEnd = Date.now() + (minutes * 60 * 1000);
    
    // Update display every second
    state.sleepTimerInterval = setInterval(() => {
        const remaining = state.sleepTimerEnd - Date.now();
        
        if (remaining <= 0) {
            // Timer expired - stop playback
            clearSleepTimer();
            stop();
            updateStatus('Sleep timer: Playback stopped');
        } else {
            updateSleepTimerDisplay(remaining);
        }
    }, 1000);
    
    updateSleepTimerDisplay(minutes * 60 * 1000);
    updateStatus(`Sleep timer set for ${minutes} minute${minutes > 1 ? 's' : ''}`);
}

export function adjustSleepTimer(deltaMinutes) {
    if (!state.sleepTimerEnd) {
        // No timer running, start a new one if positive
        if (deltaMinutes > 0) {
            setSleepTimer(deltaMinutes);
        } else {
            updateStatus('No sleep timer to adjust');
        }
        return;
    }
    
    // Add/subtract time from existing timer
    const newEnd = state.sleepTimerEnd + (deltaMinutes * 60 * 1000);
    const remaining = newEnd - Date.now();
    
    if (remaining <= 0) {
        clearSleepTimer();
        updateStatus('Sleep timer cleared');
    } else {
        state.sleepTimerEnd = newEnd;
        const mins = Math.ceil(remaining / 60000);
        updateSleepTimerDisplay(remaining);
        updateStatus(`Sleep timer: ${deltaMinutes > 0 ? '+' : ''}${deltaMinutes} min (${mins} min remaining)`);
    }
}

export function clearSleepTimer() {
    if (state.sleepTimerInterval) {
        clearInterval(state.sleepTimerInterval);
        state.sleepTimerInterval = null;
    }
    state.sleepTimerEnd = null;
    updateSleepTimerDisplay(0);
}

// Bookmarks
export function setBookmark(key) {
    if (!state.isPlaying) {
        updateStatus('No track playing to bookmark');
        return;
    }
    
    const track = state.playlist[state.playingIndex];
    state.bookmarks[key] = {
        track: track.path,
        trackIndex: state.playingIndex,
        position: state.elapsed
    };
    
    updateStatus(`Bookmark '${key}' set at ${formatDuration(state.elapsed)}`);
}

export function jumpToBookmark(key) {
    const bookmark = state.bookmarks[key];
    if (!bookmark) {
        updateStatus(`No bookmark '${key}'`);
        return;
    }
    
    // Check if it's the same track
    if (state.isPlaying && state.playlist[state.playingIndex]?.path === bookmark.track) {
        // Just seek to position
        seekTo(bookmark.position);
        updateStatus(`Jumped to bookmark '${key}' at ${formatDuration(bookmark.position)}`);
    } else {
        // Find the track in playlist and play it
        const trackIndex = state.playlist.findIndex(t => t.path === bookmark.track);
        if (trackIndex >= 0) {
            playTrack(trackIndex, bookmark.position);
            updateStatus(`Jumped to bookmark '${key}' at ${formatDuration(bookmark.position)}`);
        } else {
            updateStatus(`Bookmark '${key}' track not in playlist`);
        }
    }
}

export function deleteBookmark(key) {
    if (state.bookmarks[key]) {
        delete state.bookmarks[key];
        updateStatus(`Bookmark '${key}' deleted`);
    } else {
        updateStatus(`No bookmark '${key}'`);
    }
}

export function showBookmarks() {
    const keys = Object.keys(state.bookmarks).sort();
    if (keys.length === 0) {
        updateStatus('No bookmarks set');
        return;
    }
    
    const list = keys.map(k => {
        const b = state.bookmarks[k];
        const trackName = state.playlist.find(t => t.path === b.track)?.name || 'Unknown';
        return `'${k}': ${trackName} @ ${formatDuration(b.position)}`;
    }).join(', ');
    
    updateStatus(`Bookmarks: ${list}`);
}

// A-B Loop
export function setLoopA() {
    if (!state.isPlaying) {
        updateStatus('No track playing');
        return;
    }
    
    state.loopA = state.elapsed;
    state.loopB = null; // Reset B when setting new A
    stopLoopMonitor();
    updateLoopDisplay();
    updateStatus(`Loop A set at ${formatDuration(state.loopA)} - press B to set end point`);
}

export function setLoopB() {
    if (!state.isPlaying) {
        updateStatus('No track playing');
        return;
    }
    
    if (state.loopA === null) {
        updateStatus('Set loop point A first (press b)');
        return;
    }
    
    if (state.elapsed <= state.loopA) {
        updateStatus('Loop B must be after loop A');
        return;
    }
    
    state.loopB = state.elapsed;
    startLoopMonitor();
    updateLoopDisplay();
    updateStatus(`Loop: ${formatDuration(state.loopA)} - ${formatDuration(state.loopB)}`);
}

export function clearLoop() {
    state.loopA = null;
    state.loopB = null;
    stopLoopMonitor();
    updateLoopDisplay();
    updateStatus('Loop cleared');
}
