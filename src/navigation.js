import { state, elements } from './state.js';
import { updateStatus, refreshNowPlaying } from './ui.js';
import { formatDuration, syncBackendPlaylist } from './utils.js';
import { renderPlaylist, scrollPlaylistToIndex } from './views/playlist.js';
import { renderFolderView, updateViewModeIndicator } from './views/folder.js';
import { applyFilter } from './filter.js';
import { invoke } from './tauri.js';
import { scrollElementIntoView } from './scroll.js';

export function moveSelection(delta) {
    if (state.viewMode === 'folder') {
        if (state.folderContents.length === 0) return;
        const newIndex = Math.max(0, Math.min(state.folderContents.length - 1, state.folderSelectedIndex + delta));
        state.folderSelectedIndex = newIndex;
        renderFolderView();
        return;
    }
    
    if (state.playlist.length === 0) return;
    const newIndex = Math.max(0, Math.min(state.playlist.length - 1, state.selectedIndex + delta));
    selectTrack(newIndex);
}

export function goToTop() {
    if (state.viewMode === 'folder') {
        if (state.folderContents.length === 0) return;
        state.folderSelectedIndex = 0;
        renderFolderView();
        return;
    }
    
    if (state.playlist.length === 0) return;
    selectTrack(0);
}

export function goToBottom() {
    if (state.viewMode === 'folder') {
        if (state.folderContents.length === 0) return;
        state.folderSelectedIndex = state.folderContents.length - 1;
        renderFolderView();
        return;
    }
    
    if (state.playlist.length === 0) return;
    selectTrack(state.playlist.length - 1);
}

export function selectTrack(index) {
    state.selectedIndex = index;
    renderPlaylist();
    scrollToSelected();
}

// Bring the selected row into view. The list view is virtualized (the row may not be in
// the DOM), so it scrolls by index; other views scroll to the rendered element.
function scrollSelection(block) {
    if (state.viewMode === 'list') {
        scrollPlaylistToIndex(state.selectedIndex, block);
    } else {
        scrollElementIntoView(elements.playlist.querySelector('.track-item.selected'), elements.playlist, block);
    }
}

export function scrollToSelected() {
    scrollSelection('nearest');
}

export function scrollToFolderSelected() {
    scrollSelection('nearest');
}

export function moveSelectionRelative(offset) {
    const list = state.viewMode === 'folder' ? state.folderContents : state.playlist;
    if (list.length === 0) return;
    
    if (state.viewMode === 'folder') {
        const newIndex = Math.max(0, Math.min(list.length - 1, state.folderSelectedIndex + offset));
        state.folderSelectedIndex = newIndex;
        renderFolderView();
    } else {
        const newIndex = Math.max(0, Math.min(list.length - 1, state.selectedIndex + offset));
        selectTrack(newIndex);
    }
}

// Go to the currently playing track
export function goToPlayingTrack() {
    if (state.playingIndex < 0 || state.playingIndex >= state.playlist.length) {
        updateStatus('No track currently playing');
        return;
    }
    selectTrack(state.playingIndex);
    updateStatus(`Jumped to playing: ${state.playlist[state.playingIndex].name}`);
}

// Scroll selected element to center/top/bottom of view
export function centerSelection() {
    scrollSelection('center');
}

export function scrollSelectionTop() {
    scrollSelection('start');
}

export function scrollSelectionBottom() {
    scrollSelection('end');
}

// Reorder track in playlist
export function moveTrackDown() {
    if (state.viewMode !== 'list' || state.playlist.length === 0) return;
    const idx = state.selectedIndex;
    if (idx >= state.playlist.length - 1) return;
    
    [state.playlist[idx], state.playlist[idx + 1]] = [state.playlist[idx + 1], state.playlist[idx]];
    
    if (state.playingIndex === idx) state.playingIndex = idx + 1;
    else if (state.playingIndex === idx + 1) state.playingIndex = idx;
    
    state.selectedIndex = idx + 1;
    syncBackendPlaylist();
    renderPlaylist();
    updateStatus('Moved track down');
}

export function moveTrackUp() {
    if (state.viewMode !== 'list' || state.playlist.length === 0) return;
    const idx = state.selectedIndex;
    if (idx <= 0) return;
    
    [state.playlist[idx], state.playlist[idx - 1]] = [state.playlist[idx - 1], state.playlist[idx]];
    
    if (state.playingIndex === idx) state.playingIndex = idx - 1;
    else if (state.playingIndex === idx - 1) state.playingIndex = idx;
    
    state.selectedIndex = idx - 1;
    syncBackendPlaylist();
    renderPlaylist();
    updateStatus('Moved track up');
}

// Find next/prev track by same artist as selected track
export async function findNextArtist() {
    if (state.playlist.length === 0) return;
    const currentTrack = state.playlist[state.selectedIndex];
    if (!currentTrack) return;
    
    const currentArtist = await getTrackArtist(currentTrack.path);
    if (!currentArtist) {
        updateStatus('No artist metadata for current track');
        return;
    }
    
    for (let i = state.selectedIndex + 1; i < state.playlist.length; i++) {
        const artist = await getTrackArtist(state.playlist[i].path);
        if (artist === currentArtist) {
            selectTrack(i);
            updateStatus(`Found ${artist} at line ${i + 1}`);
            return;
        }
    }
    // Wrap around
    for (let i = 0; i < state.selectedIndex; i++) {
        const artist = await getTrackArtist(state.playlist[i].path);
        if (artist === currentArtist) {
            selectTrack(i);
            updateStatus(`Found ${artist} at line ${i + 1} (wrapped)`);
            return;
        }
    }
    updateStatus(`No other tracks by ${currentArtist}`);
}

export async function findPrevArtist() {
    if (state.playlist.length === 0) return;
    const currentTrack = state.playlist[state.selectedIndex];
    if (!currentTrack) return;
    
    const currentArtist = await getTrackArtist(currentTrack.path);
    if (!currentArtist) {
        updateStatus('No artist metadata for current track');
        return;
    }
    
    for (let i = state.selectedIndex - 1; i >= 0; i--) {
        const artist = await getTrackArtist(state.playlist[i].path);
        if (artist === currentArtist) {
            selectTrack(i);
            updateStatus(`Found ${artist} at line ${i + 1}`);
            return;
        }
    }
    // Wrap around
    for (let i = state.playlist.length - 1; i > state.selectedIndex; i--) {
        const artist = await getTrackArtist(state.playlist[i].path);
        if (artist === currentArtist) {
            selectTrack(i);
            updateStatus(`Found ${artist} at line ${i + 1} (wrapped)`);
            return;
        }
    }
    updateStatus(`No other tracks by ${currentArtist}`);
}

const artistCache = new Map();

async function getTrackArtist(path) {
    if (artistCache.has(path)) return artistCache.get(path);
    try {
        const metadata = await invoke('scan_metadata', { tracks: [path] });
        const artist = metadata?.[0]?.artist || null;
        artistCache.set(path, artist);
        return artist;
    } catch {
        return null;
    }
}

// Navigation history for Ctrl+o
export function pushNavHistory() {
    if (!state.rootFolder) return;
    state.navHistory.push({
        viewMode: state.viewMode,
        playlist: state.playlist.slice(),
        currentPlaylistName: state.currentPlaylistName,
        selectedIndex: state.selectedIndex,
        rootFolder: state.rootFolder,
        currentFolder: state.currentFolder,
        folderContents: state.folderContents,
        folderSelectedIndex: state.folderSelectedIndex,
        folderParent: state.folderParent,
        artistList: state.artistList,
        artistTracks: state.artistTracks,
        artistViewMode: state.artistViewMode,
        artistSelectedIndex: state.artistSelectedIndex,
        currentArtist: state.currentArtist,
        filterText: state.filterText,
    });
    if (state.navHistory.length > 50) state.navHistory.shift();
}

export async function navBack() {
    if (state.navHistory.length === 0) {
        updateStatus('No navigation history');
        return;
    }
    const prev = state.navHistory.pop();
    try {
        await invoke('set_playlist', { paths: prev.playlist.map(track => track.path) });
    } catch (err) {
        state.navHistory.push(prev);
        updateStatus(`Failed to navigate back: ${err}`);
        return;
    }
    Object.assign(state, prev);
    state.playingIndex = state.playlist.findIndex(track => track.path === state.playingPath);
    state.deletedTracks = [];
    state.shuffleHistory = [];
    state.shuffleIndex = -1;
    state.lastVisualSelection = null;
    elements.filterInput.value = state.filterText;
    updateViewModeIndicator();
    applyFilter();
    scrollToSelected();
    refreshNowPlaying();
    updateStatus('Navigated back');
}
