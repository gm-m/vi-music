import { state } from './state.js';
import { updateStatus, updateModeIndicators } from './ui.js';
import { renderPlaylist } from './views/playlist.js';
import { renderFolderView } from './views/folder.js';
import { scrollToSelected, scrollToFolderSelected } from './navigation.js';
import { showAddToPlaylistPicker, getSelectedTrackPaths } from './playlists.js';
import { updateQueueDisplay } from './queue.js';

export function enterVisualMode() {
    if (state.viewMode === 'folder') {
        if (state.folderContents.length === 0) return;
        state.mode = 'visual';
        state.visualStart = state.folderSelectedIndex;
        updateModeIndicators();
        renderFolderView();
    } else {
        if (state.playlist.length === 0) return;
        state.mode = 'visual';
        state.visualStart = state.selectedIndex;
        updateModeIndicators();
        renderPlaylist();
    }
}

export function exitVisualMode() {
    state.mode = 'normal';
    state.visualStart = -1;
    updateModeIndicators();
    if (state.viewMode === 'folder') {
        renderFolderView();
    } else {
        renderPlaylist();
    }
}

export function getVisualSelection() {
    if (state.visualStart === -1) return [];
    const currentIndex = state.viewMode === 'folder' ? state.folderSelectedIndex : state.selectedIndex;
    const start = Math.min(state.visualStart, currentIndex);
    const end = Math.max(state.visualStart, currentIndex);
    const indices = [];
    for (let i = start; i <= end; i++) {
        indices.push(i);
    }
    return indices;
}

export function addVisualSelectionToQueue() {
    const selection = getVisualSelection();
    if (selection.length === 0) return;
    
    if (state.viewMode === 'folder') {
        // In folder view, queue only works with files (not folders)
        let addedCount = 0;
        selection.forEach(index => {
            const item = state.folderContents[index];
            if (item && !item.is_folder) {
                const playlistIdx = state.playlist.findIndex(t => t.path === item.path);
                if (playlistIdx !== -1) {
                    state.queue.push(playlistIdx);
                    addedCount++;
                }
            }
        });
        updateQueueDisplay();
        if (addedCount > 0) {
            updateStatus(`Added ${addedCount} track${addedCount > 1 ? 's' : ''} to queue`);
        } else {
            updateStatus('No tracks to queue (only folders selected)');
        }
        exitVisualMode();
        return;
    }
    
    selection.forEach(index => {
        state.queue.push(index);
    });
    
    updateQueueDisplay();
    updateStatus(`Added ${selection.length} tracks to queue`);
    exitVisualMode();
}

export function handleVisualModeKeyDown(e) {
    const isFolderView = state.viewMode === 'folder';
    const items = isFolderView ? state.folderContents : state.playlist;
    const currentIndex = isFolderView ? state.folderSelectedIndex : state.selectedIndex;
    const render = isFolderView ? renderFolderView : renderPlaylist;
    const scroll = isFolderView ? scrollToFolderSelected : scrollToSelected;
    
    // Handle multi-key commands in visual mode
    if (state.pendingKey === 'g') {
        if (e.key === 'g') {
            if (isFolderView) {
                state.folderSelectedIndex = 0;
            } else {
                state.selectedIndex = 0;
            }
            render();
            scroll();
        }
        state.pendingKey = null;
        return;
    }
    
    switch (e.key) {
        case 'j':
            if (currentIndex < items.length - 1) {
                if (isFolderView) {
                    state.folderSelectedIndex++;
                } else {
                    state.selectedIndex++;
                }
                render();
                scroll();
            }
            break;
        case 'k':
            if (currentIndex > 0) {
                if (isFolderView) {
                    state.folderSelectedIndex--;
                } else {
                    state.selectedIndex--;
                }
                render();
                scroll();
            }
            break;
        case 'g':
            state.pendingKey = 'g';
            break;
        case 'G':
            if (isFolderView) {
                state.folderSelectedIndex = items.length - 1;
            } else {
                state.selectedIndex = items.length - 1;
            }
            render();
            scroll();
            break;
        case 'a':
            addVisualSelectionToQueue();
            break;
        case 'd':
            deleteSelectedTracks();
            break;
        case 'p':
            showAddToPlaylistPicker(getSelectedTrackPaths(getVisualSelection()));
            break;
        case 'v':
        case 'Escape':
            exitVisualMode();
            break;
    }
}

// Track Deletion
export function deleteSelectedTracks() {
    if (state.playlist.length === 0) return;
    
    let indicesToDelete;
    if (state.mode === 'visual') {
        indicesToDelete = getVisualSelection();
        exitVisualMode();
    } else {
        indicesToDelete = [state.selectedIndex];
    }
    
    if (indicesToDelete.length === 0) return;
    
    // Sort in descending order to delete from end first
    indicesToDelete.sort((a, b) => b - a);
    
    // Check if we're deleting the currently playing track
    let newPlayingIndex = state.playingIndex;
    
    for (const idx of indicesToDelete) {
        state.playlist.splice(idx, 1);
        
        // Adjust playing index
        if (idx < newPlayingIndex) {
            newPlayingIndex--;
        } else if (idx === newPlayingIndex) {
            newPlayingIndex = -1; // Currently playing track was deleted
        }
    }
    
    state.playingIndex = newPlayingIndex;
    
    // Adjust selected index
    if (state.selectedIndex >= state.playlist.length) {
        state.selectedIndex = Math.max(0, state.playlist.length - 1);
    }
    
    renderPlaylist();
    updateStatus(`Deleted ${indicesToDelete.length} track${indicesToDelete.length > 1 ? 's' : ''}`);
}

export function deleteTrackRange(start, end) {
    if (state.playlist.length === 0) return;
    
    // Convert to 0-indexed
    const startIdx = Math.max(0, start - 1);
    const endIdx = Math.min(state.playlist.length - 1, end - 1);
    
    if (startIdx > endIdx) {
        updateStatus('Invalid range');
        return;
    }
    
    const count = endIdx - startIdx + 1;
    
    // Check if we're deleting the currently playing track
    let newPlayingIndex = state.playingIndex;
    if (state.playingIndex >= startIdx && state.playingIndex <= endIdx) {
        newPlayingIndex = -1;
    } else if (state.playingIndex > endIdx) {
        newPlayingIndex -= count;
    }
    
    state.playlist.splice(startIdx, count);
    state.playingIndex = newPlayingIndex;
    
    // Adjust selected index
    if (state.selectedIndex >= state.playlist.length) {
        state.selectedIndex = Math.max(0, state.playlist.length - 1);
    }
    
    renderPlaylist();
    updateStatus(`Deleted ${count} track${count > 1 ? 's' : ''} (lines ${start}-${end})`);
}
