import { state, elements } from './state.js';
import { formatDuration } from './utils.js';
import { updateStatus, updateModeIndicators } from './ui.js';
import { playTrack } from './playback.js';

export function addToQueue() {
    if (state.viewMode === 'folder') {
        const item = state.folderContents[state.folderSelectedIndex];
        if (!item) return;
        if (item.is_folder) {
            updateStatus('Cannot queue a folder. Select a track.');
            return;
        }
        // Find the track in the playlist by path
        const playlistIdx = state.playlist.findIndex(t => t.path === item.path);
        if (playlistIdx !== -1) {
            state.queue.push(playlistIdx);
            updateQueueDisplay();
            updateStatus(`Added to queue: ${item.name} (${state.queue.length} in queue)`);
        } else {
            updateStatus('Track not in playlist');
        }
        return;
    }
    if (state.playlist.length === 0) return;
    
    const track = state.playlist[state.selectedIndex];
    state.queue.push(state.selectedIndex);
    updateQueueDisplay();
    updateStatus(`Added to queue: ${track.name} (${state.queue.length} in queue)`);
}

export function addToQueueAndPlay() {
    if (state.viewMode === 'folder') {
        // In folder view, A loads all tracks from current folder
        // This is handled via loadCurrentFolderAsPlaylist in the folder view
        return;
    }
    if (state.playlist.length === 0) return;
    
    // If nothing is playing, just play the selected track
    if (!state.isPlaying) {
        playTrack(state.selectedIndex);
        return;
    }
    
    // Add to queue
    addToQueue();
}

export function clearQueue() {
    state.queue = [];
    updateQueueDisplay();
    updateStatus('Queue cleared');
}

export function playFromQueue() {
    if (state.queue.length === 0) return;
    
    const nextIndex = state.queue.shift();
    playTrack(nextIndex);
    updateQueueDisplay();
}

export function updateQueueDisplay() {
    // Update mode indicator to show queue count
    updateModeIndicators();
    // Re-render queue view if open
    if (state.queueViewOpen) {
        renderQueueView();
    }
}

export function toggleQueueView() {
    if (state.queueViewOpen) {
        closeQueueView();
    } else {
        openQueueView();
    }
}

export function openQueueView() {
    state.queueViewOpen = true;
    state.queueSelectedIndex = 0;
    elements.queueModal.classList.add('visible');
    renderQueueView();
}

export function closeQueueView() {
    state.queueViewOpen = false;
    elements.queueModal.classList.remove('visible');
}

export function renderQueueView() {
    if (state.queue.length === 0) {
        elements.queueList.innerHTML = '<div class="queue-empty">Queue is empty</div>';
        return;
    }
    
    elements.queueList.innerHTML = state.queue.map((playlistIndex, queueIndex) => {
        const track = state.playlist[playlistIndex];
        const isSelected = queueIndex === state.queueSelectedIndex;
        return `
            <div class="queue-item ${isSelected ? 'selected' : ''}" data-index="${queueIndex}">
                <span class="queue-number">${queueIndex + 1}.</span>
                <span class="queue-name">${track.name}</span>
                <span class="queue-duration">${formatDuration(track.duration)}</span>
            </div>
        `;
    }).join('');
}

export function handleQueueViewKeyDown(e) {
    // Handle multi-key commands in queue view
    if (state.pendingKey === 'd') {
        if (e.key === 'd') {
            removeFromQueue(state.queueSelectedIndex);
        }
        state.pendingKey = null;
        return;
    }
    
    if (state.pendingKey === 'g') {
        if (e.key === 'g') {
            state.queueSelectedIndex = 0;
            renderQueueView();
        }
        state.pendingKey = null;
        return;
    }
    
    switch (e.key) {
        case 'j':
            if (state.queueSelectedIndex < state.queue.length - 1) {
                state.queueSelectedIndex++;
                renderQueueView();
            }
            break;
        case 'k':
            if (state.queueSelectedIndex > 0) {
                state.queueSelectedIndex--;
                renderQueueView();
            }
            break;
        case 'J':
            // Move selected item down
            if (state.queueSelectedIndex < state.queue.length - 1) {
                const temp = state.queue[state.queueSelectedIndex];
                state.queue[state.queueSelectedIndex] = state.queue[state.queueSelectedIndex + 1];
                state.queue[state.queueSelectedIndex + 1] = temp;
                state.queueSelectedIndex++;
                renderQueueView();
                updateQueueDisplay();
            }
            break;
        case 'K':
            // Move selected item up
            if (state.queueSelectedIndex > 0) {
                const temp = state.queue[state.queueSelectedIndex];
                state.queue[state.queueSelectedIndex] = state.queue[state.queueSelectedIndex - 1];
                state.queue[state.queueSelectedIndex - 1] = temp;
                state.queueSelectedIndex--;
                renderQueueView();
                updateQueueDisplay();
            }
            break;
        case 'g':
            state.pendingKey = 'g';
            break;
        case 'G':
            state.queueSelectedIndex = Math.max(0, state.queue.length - 1);
            renderQueueView();
            break;
        case 'd':
            state.pendingKey = 'd';
            break;
        case 'c':
            clearQueue();
            break;
        case 'Enter':
            // Play selected queue item immediately
            if (state.queue.length > 0) {
                const trackIndex = state.queue[state.queueSelectedIndex];
                state.queue.splice(state.queueSelectedIndex, 1);
                playTrack(trackIndex);
                if (state.queueSelectedIndex >= state.queue.length) {
                    state.queueSelectedIndex = Math.max(0, state.queue.length - 1);
                }
                updateQueueDisplay();
            }
            break;
        case 'q':
        case 'Escape':
            closeQueueView();
            break;
    }
}

export function removeFromQueue(index) {
    if (index >= 0 && index < state.queue.length) {
        const track = state.playlist[state.queue[index]];
        state.queue.splice(index, 1);
        if (state.queueSelectedIndex >= state.queue.length) {
            state.queueSelectedIndex = Math.max(0, state.queue.length - 1);
        }
        updateQueueDisplay();
        updateStatus(`Removed from queue: ${track.name}`);
    }
}
