import { state } from './state.js';
import { updateStatus, updateModeIndicators } from './ui.js';
import { renderPlaylist } from './views/playlist.js';
import { renderFolderView } from './views/folder.js';
import { scrollToSelected, scrollToFolderSelected } from './navigation.js';
import { showAddToPlaylistPicker, getSelectedTrackPaths } from './playlists.js';
import { updateQueueDisplay } from './queue.js';
import { syncBackendPlaylist } from './utils.js';

// Remove queue entries pointing to deleted indices and shift remaining indices
function cleanupQueueIndices(startIdx, endIdx) {
    const count = endIdx - startIdx + 1;
    state.queue = state.queue
        .filter(idx => idx < startIdx || idx > endIdx)
        .map(idx => idx > endIdx ? idx - count : idx);
    updateQueueDisplay();
}

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
    if (state.mode === 'visual' && state.visualStart !== -1) {
        state.lastVisualSelection = {
            viewMode: state.viewMode,
            visualStart: state.visualStart,
            selectedIndex: state.selectedIndex,
            folderSelectedIndex: state.folderSelectedIndex,
        };
    }
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

export function restoreLastVisualSelection() {
    const last = state.lastVisualSelection;
    if (!last) {
        updateStatus('No previous visual selection');
        return;
    }
    if (last.viewMode !== state.viewMode) {
        updateStatus('Cannot restore visual selection: view mode changed');
        return;
    }
    const isFolderView = state.viewMode === 'folder';
    const items = isFolderView ? state.folderContents : state.playlist;
    if (items.length === 0) {
        updateStatus('No items to select');
        return;
    }
    const maxIndex = items.length - 1;
    const start = Math.max(0, Math.min(maxIndex, last.visualStart));
    const end = Math.max(0, Math.min(maxIndex, isFolderView ? last.folderSelectedIndex : last.selectedIndex));
    state.visualStart = start;
    if (isFolderView) {
        state.folderSelectedIndex = end;
    } else {
        state.selectedIndex = end;
    }
    state.mode = 'visual';
    updateModeIndicators();
    if (isFolderView) {
        renderFolderView();
    } else {
        renderPlaylist();
    }
    updateStatus('Restored visual selection');
}

function swapVisualSelection() {
    const isFolderView = state.viewMode === 'folder';
    if (isFolderView) {
        const tmp = state.visualStart;
        state.visualStart = state.folderSelectedIndex;
        state.folderSelectedIndex = tmp;
    } else {
        const tmp = state.visualStart;
        state.visualStart = state.selectedIndex;
        state.selectedIndex = tmp;
    }
    const render = isFolderView ? renderFolderView : renderPlaylist;
    const scroll = isFolderView ? scrollToFolderSelected : scrollToSelected;
    render();
    scroll();
}

function moveVisualSelectionDown() {
    if (state.viewMode !== 'list') {
        updateStatus('Cannot reorder in this view');
        return;
    }
    if (state.playlist.length === 0) return;
    const start = Math.min(state.visualStart, state.selectedIndex);
    const end = Math.max(state.visualStart, state.selectedIndex);
    if (end >= state.playlist.length - 1) return;

    const [moved] = state.playlist.splice(end + 1, 1);
    state.playlist.splice(start, 0, moved);

    if (state.playingIndex === end + 1) {
        state.playingIndex = start;
    } else if (state.playingIndex >= start && state.playingIndex <= end) {
        state.playingIndex += 1;
    }

    state.visualStart += 1;
    state.selectedIndex += 1;

    renderPlaylist();
    updateStatus('Moved selection down');
}

function moveVisualSelectionUp() {
    if (state.viewMode !== 'list') {
        updateStatus('Cannot reorder in this view');
        return;
    }
    if (state.playlist.length === 0) return;
    const start = Math.min(state.visualStart, state.selectedIndex);
    const end = Math.max(state.visualStart, state.selectedIndex);
    if (start <= 0) return;

    const [moved] = state.playlist.splice(start - 1, 1);
    state.playlist.splice(end, 0, moved);

    if (state.playingIndex === start - 1) {
        state.playingIndex = end;
    } else if (state.playingIndex >= start && state.playingIndex <= end) {
        state.playingIndex -= 1;
    }

    state.visualStart -= 1;
    state.selectedIndex -= 1;

    renderPlaylist();
    updateStatus('Moved selection up');
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
    
    // Handle count prefix
    if (/^[0-9]$/.test(e.key) && state.pendingKey === null) {
        if (state.countPrefix !== '' || e.key !== '0') {
            state.countPrefix += e.key;
            return;
        }
    }
    const count = parseInt(state.countPrefix) || 1;
    
    // Handle Ctrl+d / Ctrl+u in visual mode (before switch to avoid 'd' case catching Ctrl+d)
    if (e.ctrlKey && (e.key === 'd' || e.key === 'u')) {
        e.preventDefault();
        const delta = (e.key === 'd' ? 1 : -1) * 10 * count;
        if (isFolderView) {
            state.folderSelectedIndex = Math.max(0, Math.min(items.length - 1, state.folderSelectedIndex + delta));
        } else {
            state.selectedIndex = Math.max(0, Math.min(items.length - 1, state.selectedIndex + delta));
        }
        render();
        scroll();
        state.countPrefix = '';
        return;
    }
    
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
        state.countPrefix = '';
        return;
    }
    
    switch (e.key) {
        case 'j':
            for (let i = 0; i < count; i++) {
                if (isFolderView) {
                    if (state.folderSelectedIndex < items.length - 1) state.folderSelectedIndex++;
                } else {
                    if (state.selectedIndex < items.length - 1) state.selectedIndex++;
                }
            }
            render();
            scroll();
            state.countPrefix = '';
            break;
        case 'k':
            for (let i = 0; i < count; i++) {
                if (isFolderView) {
                    if (state.folderSelectedIndex > 0) state.folderSelectedIndex--;
                } else {
                    if (state.selectedIndex > 0) state.selectedIndex--;
                }
            }
            render();
            scroll();
            state.countPrefix = '';
            break;
        case 'g':
            state.pendingKey = 'g';
            state.countPrefix = '';
            return;
        case 'G':
            if (state.countPrefix) {
                const targetIdx = Math.min(count - 1, items.length - 1);
                if (isFolderView) state.folderSelectedIndex = targetIdx;
                else state.selectedIndex = targetIdx;
            } else {
                if (isFolderView) state.folderSelectedIndex = items.length - 1;
                else state.selectedIndex = items.length - 1;
            }
            render();
            scroll();
            state.countPrefix = '';
            break;
        case 'a':
            addVisualSelectionToQueue();
            state.countPrefix = '';
            break;
        case 'd':
            deleteSelectedTracks();
            state.countPrefix = '';
            break;
        case 'p':
            showAddToPlaylistPicker(getSelectedTrackPaths(getVisualSelection()));
            state.countPrefix = '';
            break;
        case 'o':
            swapVisualSelection();
            state.countPrefix = '';
            break;
        case '>':
            moveVisualSelectionDown();
            state.countPrefix = '';
            break;
        case '<':
            moveVisualSelectionUp();
            state.countPrefix = '';
            break;
        case 'v':
        case 'Escape':
            exitVisualMode();
            state.countPrefix = '';
            break;
        default:
            state.countPrefix = '';
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
    
    // Save deleted tracks for undo
    const deletedTracks = indicesToDelete.map(idx => ({
        track: state.playlist[idx],
        index: idx,
    }));
    
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
    
    // Push to undo stack
    state.deletedTracks.push({
        tracks: deletedTracks,
        playingIndex: state.playingIndex,
    });
    
    // Clean up queue indices
    const minIdx = Math.min(...indicesToDelete);
    const maxIdx = Math.max(...indicesToDelete);
    cleanupQueueIndices(minIdx, maxIdx);
    syncBackendPlaylist();
    
    renderPlaylist();
    updateStatus(`Deleted ${indicesToDelete.length} track${indicesToDelete.length > 1 ? 's' : ''}`);
}

// x - delete single track at cursor
export function deleteTrack() {
    if (state.playlist.length === 0) return;
    deleteSelectedTracks();
}

// D - delete from current track to end of playlist
export function deleteToEnd() {
    if (state.playlist.length === 0) return;
    if (state.viewMode !== 'list') return;
    
    const startIdx = state.selectedIndex;
    const endIdx = state.playlist.length - 1;
    
    if (startIdx > endIdx) return;
    
    // Save deleted tracks for undo
    const deletedTracks = [];
    for (let i = startIdx; i <= endIdx; i++) {
        deletedTracks.push({ track: state.playlist[i], index: i });
    }
    
    const count = endIdx - startIdx + 1;
    let newPlayingIndex = state.playingIndex;
    
    if (state.playingIndex >= startIdx) {
        newPlayingIndex = -1;
    }
    
    state.playlist.splice(startIdx, count);
    state.playingIndex = newPlayingIndex;
    state.selectedIndex = Math.max(0, state.playlist.length - 1);
    
    state.deletedTracks.push({
        tracks: deletedTracks,
        playingIndex: state.playingIndex,
    });
    
    // Clean up queue indices
    cleanupQueueIndices(startIdx, endIdx);
    syncBackendPlaylist();
    
    renderPlaylist();
    updateStatus(`Deleted ${count} track${count > 1 ? 's' : ''} to end`);
}

// u - undo last deletion
export function undoDelete() {
    if (state.deletedTracks.length === 0) {
        updateStatus('Nothing to undo');
        return;
    }
    
    const lastDelete = state.deletedTracks.pop();
    // Sort by index ascending to reinsert
    lastDelete.tracks.sort((a, b) => a.index - b.index);
    
    for (const { track, index } of lastDelete.tracks) {
        state.playlist.splice(index, 0, track);
    }
    
    // Restore playing index if it was -1 (deleted track was playing)
    // Otherwise adjust if tracks were inserted before it
    if (state.playingIndex === -1) {
        state.playingIndex = lastDelete.playingIndex;
        // Adjust if the restored playing index needs updating
        for (const { index } of lastDelete.tracks) {
            if (index <= state.playingIndex) {
                state.playingIndex++;
            }
        }
    } else {
        for (const { index } of lastDelete.tracks) {
            if (index <= state.playingIndex) {
                state.playingIndex++;
            }
        }
    }
    
    // Restore selected index
    if (lastDelete.tracks.length > 0) {
        state.selectedIndex = lastDelete.tracks[0].index;
    }
    
    syncBackendPlaylist();
    renderPlaylist();
    updateStatus(`Restored ${lastDelete.tracks.length} track${lastDelete.tracks.length > 1 ? 's' : ''}`);
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
    
    // Save deleted tracks for undo
    const deletedTracks = [];
    for (let i = startIdx; i <= endIdx; i++) {
        deletedTracks.push({ track: state.playlist[i], index: i });
    }
    
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
    
    // Push to undo stack
    state.deletedTracks.push({
        tracks: deletedTracks,
        playingIndex: state.playingIndex,
    });
    
    // Clean up queue indices
    cleanupQueueIndices(startIdx, endIdx);
    syncBackendPlaylist();
    
    renderPlaylist();
    updateStatus(`Deleted ${count} track${count > 1 ? 's' : ''} (lines ${start}-${end})`);
}
