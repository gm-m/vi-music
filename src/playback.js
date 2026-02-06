import { invoke } from './tauri.js';
import { state, elements } from './state.js';
import { updateNowPlaying, updateStatus, updatePlayButton, updateVolumeDisplay, updateSpeedDisplay, updateProgressDisplay, resetProgressDisplay, updateModeIndicators, updateLoopDisplay } from './ui.js';
import { scrollToSelected } from './navigation.js';
import { renderPlaylist } from './views/playlist.js';
import { handleFolderItemAction, renderFolderView } from './views/folder.js';
import { updateQueueDisplay } from './queue.js';

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

export async function playSelected() {
    if (state.viewMode === 'folder') {
        if (state.folderContents.length === 0) return;
        handleFolderItemAction(state.folderSelectedIndex);
        return;
    }
    
    if (state.playlist.length === 0) return;
    await playTrack(state.selectedIndex);
}

export async function playTrack(index, seekPosition = 0) {
    try {
        // Clear A-B loop when changing tracks
        if (state.playingIndex !== index) {
            state.loopA = null;
            state.loopB = null;
            stopLoopMonitor();
            updateLoopDisplay();
        }
        
        const result = await invoke('play_track', { index, skipSecs: seekPosition });
        state.playingIndex = index;
        state.isPlaying = true;
        state.isPaused = false;
        state.duration = result.duration;
        state.elapsed = seekPosition;
        updateNowPlaying(result.name);
        renderCurrentView();
        updatePlayButton();
        updateProgressDisplay();
    } catch (err) {
        console.error('Failed to play track:', err);
        updateStatus(`Error: ${err}`);
    }
}

export async function togglePause() {
    try {
        const isPaused = await invoke('toggle_pause');
        state.isPaused = isPaused;
        updatePlayButton();
        updateStatus(isPaused ? 'Paused' : 'Playing');
    } catch (err) {
        // No track playing, try to play selected
        if (state.playlist.length > 0) {
            await playSelected();
        }
    }
}

export async function stop() {
    try {
        await invoke('stop');
        state.isPlaying = false;
        state.isPaused = false;
        state.playingIndex = -1;
        state.duration = null;
        updateNowPlaying('No track selected');
        updateStatus('Stopped');
        renderCurrentView();
        updatePlayButton();
        resetProgressDisplay();
    } catch (err) {
        console.error('Failed to stop:', err);
    }
}

export async function nextTrack() {
    if (state.shuffleMode && state.isPlaying) {
        playNextShuffle();
        return;
    }
    
    try {
        const result = await invoke('next_track');
        state.playingIndex = result.index;
        state.selectedIndex = result.index;
        state.isPlaying = true;
        state.isPaused = false;
        state.duration = result.duration;
        updateNowPlaying(result.name);
        renderCurrentView();
        updatePlayButton();
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
    
    try {
        const result = await invoke('prev_track');
        state.playingIndex = result.index;
        state.selectedIndex = result.index;
        state.isPlaying = true;
        state.isPaused = false;
        state.duration = result.duration;
        updateNowPlaying(result.name);
        renderCurrentView();
        updatePlayButton();
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
        await invoke('seek_relative', { delta });
    } catch (err) {
        // Ignore if not playing
    }
}

export async function seekTo(position) {
    try {
        await invoke('seek', { position });
    } catch (err) {
        // Ignore if not playing
    }
}

// Jump to percentage of track
export function jumpToPercent(percent) {
    if (!state.isPlaying || !state.duration) {
        updateStatus('No track playing');
        return;
    }
    const position = Math.floor((percent / 100) * state.duration);
    seekTo(position);
    updateStatus(`Jumped to ${percent}%`);
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

export function handleTrackEnd() {
    // Cap progress at 100%
    if (state.duration) {
        state.elapsed = state.duration;
    }
    updateProgressDisplay();
    
    // Check queue first (unless repeat-one is active)
    if (state.repeatMode !== 'one' && state.queue.length > 0) {
        const nextIndex = state.queue.shift();
        playTrack(nextIndex);
        updateQueueDisplay();
        return;
    }
    
    if (state.repeatMode === 'one') {
        // Repeat current track
        playTrack(state.playingIndex);
    } else if (state.shuffleMode) {
        // Play random track
        playNextShuffle();
    } else if (state.repeatMode === 'all') {
        // Play next, wrap around
        const nextIndex = (state.playingIndex + 1) % state.playlist.length;
        playTrack(nextIndex);
    } else {
        // No repeat - play next if not at end
        if (state.playingIndex < state.playlist.length - 1) {
            playTrack(state.playingIndex + 1);
        } else {
            // End of playlist
            state.isPlaying = false;
            elements.playIcon.style.display = 'block';
            elements.pauseIcon.style.display = 'none';
        }
    }
}

export function playNextShuffle() {
    if (state.playlist.length === 0) return;
    
    // If we're not at the end of history, go forward
    if (state.shuffleIndex < state.shuffleHistory.length - 1) {
        state.shuffleIndex++;
        playTrack(state.shuffleHistory[state.shuffleIndex]);
        return;
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
    playTrack(nextIndex);
}

export function playPrevShuffle() {
    if (state.shuffleHistory.length === 0 || state.shuffleIndex <= 0) {
        return;
    }
    state.shuffleIndex--;
    playTrack(state.shuffleHistory[state.shuffleIndex]);
}

// Progress Bar
export function startProgressUpdater() {
    if (state.progressInterval) {
        clearInterval(state.progressInterval);
    }
    state.progressInterval = setInterval(updateProgress, 500);
}

export async function updateProgress() {
    if (!state.isPlaying) {
        return;
    }
    
    try {
        const status = await invoke('get_status');
        state.elapsed = status.elapsed;
        state.duration = status.duration;
        
        // Sync speed from backend
        if (status.speed !== state.speed) {
            state.speed = status.speed;
            updateSpeedDisplay();
        }
        
        // Check if track finished
        if (status.is_finished) {
            handleTrackEnd();
        }
        
        updateProgressDisplay();
    } catch (err) {
        // Ignore errors
    }
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
    
    state.loopInterval = setInterval(() => {
        if (!state.isPlaying || state.loopA === null || state.loopB === null) {
            stopLoopMonitor();
            return;
        }
        
        // Check if we've passed loop B point
        if (state.elapsed >= state.loopB) {
            seekTo(state.loopA);
        }
    }, 100); // Check every 100ms for smooth looping
}

// Media control listener
export async function setupMediaControlListener(listen) {
    if (!listen) return;
    
    await listen('media-control', (event) => {
        console.log('Media control event:', event.payload);
        switch (event.payload) {
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
        }
    });
}

export async function refreshStatus() {
    try {
        const status = await invoke('get_status');
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
