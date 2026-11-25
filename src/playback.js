import { invoke } from './tauri.js';
import { state, elements } from './state.js';
import { updateNowPlaying, updateStatus, updatePlayButton, updateVolumeDisplay, updateSpeedDisplay, updateProgressDisplay, resetProgressDisplay, updateModeIndicators, updateLoopDisplay } from './ui.js';
import { scrollToSelected } from './navigation.js';
import { renderPlaylist } from './views/playlist.js';
import { handleFolderItemAction, renderFolderView } from './views/folder.js';
import { updateQueueDisplay, dequeueNextIndex } from './queue.js';
import { trackLabel, requestTrackTags } from './tags.js';
import { observeListening } from './stats.js';

let playbackId = 0;
let finishedPlaybackId = null;
let playbackRequest = 0;
let pendingTransportCommands = 0;

export function syncListening(advancing = state.isPlaying && !state.isPaused && finishedPlaybackId !== playbackId) {
    observeListening(playbackId, state.playingPath, state.duration, advancing);
}

// View-aware render: re-renders whichever view is currently active
function renderCurrentView() {
    if (state.viewMode === 'artist') {
        import('./views/artist.js').then(m => m.renderArtistView());
    } else if (state.viewMode === 'folder') {
        renderFolderView();
    } else {
        renderPlaylist();
    }
}

export function setElapsed(position) {
    state.elapsed = position;
    state.elapsedSyncedAt = performance.now();
}

// Current position estimated from the last backend sync (status is pushed every 250ms while playing)
export function getElapsed() {
    if (!state.isPlaying || state.isPaused) return state.elapsed;
    const estimate = state.elapsed + ((performance.now() - state.elapsedSyncedAt) / 1000) * state.speed;
    return state.duration ? Math.min(estimate, state.duration) : estimate;
}

export async function playSelected() {
    if (state.viewMode === 'folder') {
        if (state.folderContents.length === 0) return;
        handleFolderItemAction(state.folderSelectedIndex);
        return;
    }
    
    if (state.playlist.length === 0) return;
    await playTrack(state.selectedIndex);
}

function getTrackStartPosition(index, seekPosition, allowCarryPosition) {
    if (typeof seekPosition === 'number') {
        return seekPosition;
    }
    if (!allowCarryPosition || !state.settings.carryposition) {
        return 0;
    }
    if (!state.isPlaying || state.playingIndex < 0 || state.playingIndex === index) {
        return 0;
    }
    const targetDuration = state.playlist[index]?.duration;
    if (typeof targetDuration === 'number') {
        return Math.min(getElapsed(), targetDuration);
    }
    return getElapsed();
}

export async function playTrack(index, seekPosition = null, allowCarryPosition = true) {
    playbackRequest++;
    pendingTransportCommands++;
    try {
        const startPosition = getTrackStartPosition(index, seekPosition, allowCarryPosition);
        const result = await invoke('play_track', { index, skipSecs: startPosition });
        playbackId = result.playback_id;
        // Clear A-B loop when changing tracks
        if (state.playingPath !== result.path) {
            state.loopA = null;
            state.loopB = null;
            stopLoopMonitor();
            updateLoopDisplay();
        }
        
        state.playingPath = result.path;
        state.playingIndex = state.playlist[index]?.path === result.path
            ? index : state.playlist.findIndex(track => track.path === result.path);
        state.isPlaying = true;
        state.isPaused = false;
        state.duration = result.duration;
        syncListening();
        setElapsed(startPosition);
        const track = state.playlist[state.playingIndex];
        updateNowPlaying(track ? trackLabel(track) : result.name);
        if (track) requestTrackTags([track.path]);
        renderCurrentView();
        updatePlayButton();
        updateProgressDisplay();
        return true;
    } catch (err) {
        console.error('Failed to play track:', err);
        updateStatus(`Error: ${err}`);
        return false;
    } finally {
        pendingTransportCommands--;
        advanceFinishedPlayback();
    }
}

export async function togglePause() {
    try {
        const isPaused = await invoke('toggle_pause');
        state.isPaused = isPaused;
        syncListening();
        updatePlayButton();
    } catch (err) {
        // No track playing, try to play selected
        if (state.playlist.length > 0) {
            await playSelected();
        }
    }
}

export async function stop() {
    playbackRequest++;
    pendingTransportCommands++;
    try {
        await invoke('stop');
        state.isPlaying = false;
        state.isPaused = false;
        state.playingIndex = -1;
        state.playingPath = null;
        state.duration = null;
        syncListening(false);
        setElapsed(0);
        state.loopA = null;
        state.loopB = null;
        stopLoopMonitor();
        updateLoopDisplay();
        updateNowPlaying('No track selected');
        renderCurrentView();
        updatePlayButton();
        resetProgressDisplay();
    } catch (err) {
        console.error('Failed to stop:', err);
    } finally {
        pendingTransportCommands--;
        advanceFinishedPlayback();
    }
}

export async function nextTrack() {
    if (state.shuffleMode && state.isPlaying) {
        playNextShuffle();
        return;
    }
    if (state.playlist.length === 0) return;
    
    try {
        const currentIndex = state.playingIndex >= 0 ? state.playingIndex : state.selectedIndex;
        const nextIndex = (currentIndex + 1) % state.playlist.length;
        state.selectedIndex = nextIndex;
        await playTrack(nextIndex);
        scrollToSelected();
    } catch (err) {
        console.error('Failed to play next track:', err);
    }
}

export async function prevTrack() {
    if (state.shuffleMode && state.isPlaying) {
        playPrevShuffle();
        return;
    }
    if (state.playlist.length === 0) return;
    
    try {
        const currentIndex = state.playingIndex >= 0 ? state.playingIndex : state.selectedIndex;
        const prevIndex = currentIndex === 0 ? state.playlist.length - 1 : currentIndex - 1;
        state.selectedIndex = prevIndex;
        await playTrack(prevIndex);
        scrollToSelected();
    } catch (err) {
        console.error('Failed to play previous track:', err);
    }
}

// Volume
export async function adjustVolume(delta) {
    const newVolume = Math.max(0, Math.min(1, state.volume + delta));
    await setVolume(newVolume);
}

export async function setVolume(volume) {
    try {
        const result = await invoke('set_volume', { volume });
        state.volume = result;
        updateVolumeDisplay();
    } catch (err) {
        console.error('Failed to set volume:', err);
    }
}

export function toggleMute() {
    if (state.volume > 0) {
        state.previousVolume = state.volume;
        setVolume(0);
    } else {
        setVolume(state.previousVolume);
    }
}

// Speed Control
export async function changeSpeed(delta) {
    const newSpeed = Math.max(0.25, Math.min(3.0, state.speed + delta));
    await setSpeed(newSpeed);
}

export async function resetSpeed() {
    await setSpeed(1.0);
}

export async function setSpeed(speed) {
    try {
        const result = await invoke('set_speed', { speed });
        state.speed = result;
        updateSpeedDisplay();
    } catch (err) {
        console.error('Failed to set speed:', err);
    }
}

// Seeking
export async function seekRelative(delta) {
    try {
        const newPos = await invoke('seek_relative', { delta });
        setElapsed(newPos);
        updateProgressDisplay();
    } catch (err) {
        console.error('seek_relative failed:', err);
    }
}

export async function seekTo(position) {
    try {
        const newPos = await invoke('seek', { position });
        setElapsed(newPos);
        updateProgressDisplay();
        return newPos;
    } catch (err) {
        console.error('seek failed:', err);
    }
}

// Jump to percentage of track
export function jumpToPercent(percent) {
    if (!state.isPlaying || !state.duration) {
        updateStatus('No track playing');
        return;
    }
    const position = (percent / 100) * state.duration;
    seekTo(position);
    updateStatus(`Jumped to ${percent}%`);
}

// Seek to start/end of track
export function seekToStart() {
    if (!state.isPlaying) {
        updateStatus('No track playing');
        return;
    }
    seekTo(0);
    updateStatus('Seeked to start');
}

export function seekToEnd() {
    if (!state.isPlaying || !state.duration) {
        updateStatus('No track playing');
        return;
    }
    seekTo(Math.max(0, state.duration - 0.05));
    updateStatus('Seeked to end');
}

// Repeat & Shuffle
export function toggleRepeat() {
    const modes = ['off', 'one', 'all'];
    const currentIndex = modes.indexOf(state.repeatMode);
    state.repeatMode = modes[(currentIndex + 1) % modes.length];
    // Disable shuffle when enabling repeat-one as they conflict
    if (state.repeatMode === 'one' && state.shuffleMode) {
        state.shuffleMode = false;
    }
    updateModeIndicators();
    updateStatus(`Repeat: ${state.repeatMode}`);
}

export function toggleShuffle() {
    state.shuffleMode = !state.shuffleMode;
    if (state.shuffleMode) {
        // Reset shuffle history when enabling
        state.shuffleHistory = [];
        state.shuffleIndex = -1;
        // Disable repeat-one as it conflicts with shuffle
        if (state.repeatMode === 'one') {
            state.repeatMode = 'off';
        }
    }
    updateModeIndicators();
    updateStatus(`Shuffle: ${state.shuffleMode ? 'on' : 'off'}`);
}

function advanceFinishedPlayback() {
    if (pendingTransportCommands === 0 && state.isPlaying && finishedPlaybackId === playbackId) {
        finishedPlaybackId = null;
        void handleTrackEnd();
    }
}

async function handleTrackEnd() {
    // Cap progress at 100%
    if (state.duration) {
        state.elapsed = state.duration;
    }
    updateProgressDisplay();

    async function advance(start) {
        const attempt = start();
        const request = playbackRequest;
        const played = await attempt;
        return played || request !== playbackRequest;
    }
    
    // Check queue first (unless repeat-one is active)
    while (state.repeatMode !== 'one' && state.queue.length > 0) {
        const nextIndex = dequeueNextIndex();
        updateQueueDisplay();
        if (nextIndex !== -1 && await advance(() => playTrack(nextIndex, 0, false))) return;
    }
    
    if (state.repeatMode === 'one') {
        // Repeat current track
        if (state.playingIndex >= 0 && await advance(() => playTrack(state.playingIndex, 0, false))) return;
    } else if (state.shuffleMode) {
        // Play random track
        if (await advance(() => playNextShuffle(false))) return;
    } else {
        const trackCount = state.playlist.length;
        const first = state.playingIndex + 1;
        const end = state.repeatMode === 'all' ? first + trackCount : trackCount;
        for (let i = first; i < end; i++) {
            if (await advance(() => playTrack(i % trackCount, 0, false))) return;
        }
    }
    await stop();
}

export function playNextShuffle(allowCarryPosition = true) {
    if (state.playlist.length === 0) return;
    
    // If we're not at the end of history, go forward
    if (state.shuffleIndex < state.shuffleHistory.length - 1) {
        state.shuffleIndex++;
        state.selectedIndex = state.shuffleHistory[state.shuffleIndex];
        return playTrack(state.shuffleHistory[state.shuffleIndex], null, allowCarryPosition);
    }
    
    // Pick a random track (avoid current if possible)
    let nextIndex;
    if (state.playlist.length === 1) {
        nextIndex = 0;
    } else {
        do {
            nextIndex = Math.floor(Math.random() * state.playlist.length);
        } while (nextIndex === state.playingIndex);
    }
    
    state.shuffleHistory.push(nextIndex);
    state.shuffleIndex = state.shuffleHistory.length - 1;
    state.selectedIndex = nextIndex;
    return playTrack(nextIndex, null, allowCarryPosition);
}

export function playPrevShuffle() {
    if (state.shuffleHistory.length === 0 || state.shuffleIndex <= 0) {
        return;
    }
    state.shuffleIndex--;
    state.selectedIndex = state.shuffleHistory[state.shuffleIndex];
    playTrack(state.shuffleHistory[state.shuffleIndex]);
}

// Progress: the backend pushes `player-status` on changes (and every 250ms while playing)
// and `track-finished` once when a track ends
function applyStatus(status) {
    if (!state.isPlaying || !status.is_playing || status.playback_id !== playbackId) return;
    
    setElapsed(status.elapsed);
    state.duration = status.duration;
    syncListening(!status.is_paused && !status.is_finished);
    
    // Sync speed from backend
    if (status.speed !== state.speed) {
        state.speed = status.speed;
        updateSpeedDisplay();
    }
    
    updateProgressDisplay();
}

export async function setupStatusListener(listen) {
    if (!listen) return;
    
    await listen('player-status', (event) => applyStatus(event.payload));
    await listen('track-finished', (event) => {
        finishedPlaybackId = event.payload;
        if (finishedPlaybackId === playbackId) syncListening(false);
        advanceFinishedPlayback();
    });
}

// A-B Loop monitor
export function stopLoopMonitor() {
    if (state.loopInterval) {
        clearInterval(state.loopInterval);
        state.loopInterval = null;
    }
}

export function startLoopMonitor() {
    stopLoopMonitor();
    let seeking = false;
    
    state.loopInterval = setInterval(async () => {
        if (!state.isPlaying || state.loopA === null || state.loopB === null) {
            stopLoopMonitor();
            return;
        }
        
        // Check if we've passed loop B point (using the interpolated position)
        if (!seeking && getElapsed() >= state.loopB) {
            seeking = true;
            await seekTo(state.loopA);
            seeking = false;
        }
    }, 25);
}

// Media control listener
export async function setupMediaControlListener(listen) {
    if (!listen) return;
    
    await listen('media-control', (event) => {
        const payload = typeof event.payload === 'string'
            ? { action: event.payload, position: null, delta: null }
            : event.payload;
        console.log('Media control event:', payload);
        switch (payload.action) {
            case 'play':
                if (state.isPaused) {
                    togglePause();
                } else if (!state.isPlaying && state.playlist.length > 0) {
                    playTrack(state.selectedIndex);
                }
                break;
            case 'pause':
                if (state.isPlaying && !state.isPaused) {
                    togglePause();
                }
                break;
            case 'toggle':
                togglePause();
                break;
            case 'next':
                nextTrack();
                break;
            case 'prev':
                prevTrack();
                break;
            case 'stop':
                stop();
                break;
            case 'setPosition':
                if (typeof payload.position === 'number') {
                    seekTo(payload.position);
                }
                break;
            case 'seekBy':
                if (typeof payload.delta === 'number' && payload.delta !== 0) {
                    seekRelative(payload.delta);
                }
                break;
            case 'seekForward':
                seekRelative(state.settings.seektime);
                break;
            case 'seekBackward':
                seekRelative(-state.settings.seektime);
                break;
        }
    });
}

export async function refreshStatus() {
    try {
        const status = await invoke('get_status');
        playbackId = status.playback_id;
        state.isPlaying = status.is_playing;
        state.isPaused = status.is_paused;
        state.volume = status.volume;
        if (status.current_track) {
            updateNowPlaying(status.current_track);
        }
        updateVolumeDisplay();
        updatePlayButton();
    } catch (err) {
        console.error('Failed to get status:', err);
    }
}
