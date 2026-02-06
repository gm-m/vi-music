import { state, elements } from './state.js';
import { updateStatus, updateModeIndicators } from './ui.js';
import { renderPlaylist } from './views/playlist.js';
import { renderFolderView } from './views/folder.js';
import { renderArtistView } from './views/artist.js';
import { scrollToSelected, selectTrack } from './navigation.js';

// Filter Mode
export function enterFilterMode() {
    state.mode = 'filter';
    elements.modeIndicator.textContent = 'FILTER';
    elements.modeIndicator.classList.add('filter');
    elements.helpBar.style.display = 'none';
    elements.filterLine.style.display = 'flex';
    elements.filterInput.value = state.filterText;
    elements.filterInput.focus();
    elements.filterInput.select();
}

export function exitFilterMode() {
    state.mode = 'normal';
    updateModeIndicators();
    elements.modeIndicator.classList.remove('filter');
    elements.helpBar.style.display = 'flex';
    elements.filterLine.style.display = 'none';
}

export function handleFilterInput(e) {
    state.filterText = elements.filterInput.value;
    applyFilter();
}

export function handleFilterKeydown(e) {
    e.stopPropagation();
    if (e.key === 'Enter') {
        e.preventDefault();
        exitFilterMode();
        let hasMatches;
        if (state.viewMode === 'artist') {
            hasMatches = state.filteredArtistItems.length > 0;
        } else if (state.viewMode === 'folder') {
            hasMatches = state.filteredFolderContents.length > 0;
        } else {
            hasMatches = state.filteredPlaylist.length > 0;
        }
        if (hasMatches) {
            jumpToNextMatch();
        }
    } else if (e.key === 'Escape') {
        e.preventDefault();
        clearFilter();
        exitFilterMode();
    }
}

export function applyFilter() {
    if (!state.filterText) {
        state.filteredPlaylist = [];
        state.filteredFolderContents = [];
        state.filteredArtistItems = [];
        renderCurrentView();
        return;
    }
    
    // Try regex first, fall back to literal search if invalid
    let matcher;
    try {
        const regex = new RegExp(state.filterText, 'i');
        matcher = (text) => regex.test(text);
    } catch (e) {
        // Invalid regex, fall back to literal search
        const query = state.filterText.toLowerCase();
        matcher = (text) => text.toLowerCase().includes(query);
    }
    
    if (state.viewMode === 'artist') {
        if (state.artistViewMode === 'list') {
            state.filteredArtistItems = state.artistList
                .map((artist, index) => ({ item: artist, index }))
                .filter(({ item }) => matcher(item.name));
        } else {
            state.filteredArtistItems = state.artistTracks
                .map((track, index) => ({ item: track, index }))
                .filter(({ item }) => matcher(item.name));
        }
        renderArtistView();
    } else if (state.viewMode === 'folder') {
        state.filteredFolderContents = state.folderContents
            .map((item, index) => ({ item, index }))
            .filter(({ item }) => matcher(item.name));
        renderFolderView();
    } else {
        state.filteredPlaylist = state.playlist
            .map((track, index) => ({ track, index }))
            .filter(({ track }) => matcher(track.name));
        renderPlaylist();
    }
    updateFilterStatus();
}

export function clearFilter() {
    state.filterText = '';
    state.filteredPlaylist = [];
    state.filteredFolderContents = [];
    state.filteredArtistItems = [];
    elements.filterInput.value = '';
    renderCurrentView();
}

export function renderCurrentView() {
    if (state.viewMode === 'artist') {
        renderArtistView();
    } else if (state.viewMode === 'folder') {
        renderFolderView();
    } else {
        renderPlaylist();
    }
}

export function jumpToNextMatch() {
    if (state.viewMode === 'artist') {
        if (state.filteredArtistItems.length === 0) return;
        const currentIdx = state.artistSelectedIndex;
        const nextMatch = state.filteredArtistItems.find(({ index }) => index > currentIdx);
        if (nextMatch) {
            state.artistSelectedIndex = nextMatch.index;
        } else {
            state.artistSelectedIndex = state.filteredArtistItems[0].index;
        }
        renderArtistView();
        scrollToSelected();
        return;
    }
    
    if (state.viewMode === 'folder') {
        if (state.filteredFolderContents.length === 0) return;
        const currentIdx = state.folderSelectedIndex;
        const nextMatch = state.filteredFolderContents.find(({ index }) => index > currentIdx);
        if (nextMatch) {
            state.folderSelectedIndex = nextMatch.index;
        } else {
            state.folderSelectedIndex = state.filteredFolderContents[0].index;
        }
        renderFolderView();
        scrollToSelected();
        return;
    }
    
    if (state.filteredPlaylist.length === 0) return;
    const currentIdx = state.selectedIndex;
    const nextMatch = state.filteredPlaylist.find(({ index }) => index > currentIdx);
    
    if (nextMatch) {
        selectTrack(nextMatch.index);
    } else {
        selectTrack(state.filteredPlaylist[0].index);
    }
}

export function jumpToPrevMatch() {
    if (state.viewMode === 'artist') {
        if (state.filteredArtistItems.length === 0) return;
        const currentIdx = state.artistSelectedIndex;
        const matches = state.filteredArtistItems.filter(({ index }) => index < currentIdx);
        if (matches.length > 0) {
            state.artistSelectedIndex = matches[matches.length - 1].index;
        } else {
            state.artistSelectedIndex = state.filteredArtistItems[state.filteredArtistItems.length - 1].index;
        }
        renderArtistView();
        scrollToSelected();
        return;
    }
    
    if (state.viewMode === 'folder') {
        if (state.filteredFolderContents.length === 0) return;
        const currentIdx = state.folderSelectedIndex;
        const matches = state.filteredFolderContents.filter(({ index }) => index < currentIdx);
        if (matches.length > 0) {
            state.folderSelectedIndex = matches[matches.length - 1].index;
        } else {
            state.folderSelectedIndex = state.filteredFolderContents[state.filteredFolderContents.length - 1].index;
        }
        renderFolderView();
        scrollToSelected();
        return;
    }
    
    if (state.filteredPlaylist.length === 0) return;
    const currentIdx = state.selectedIndex;
    const matches = state.filteredPlaylist.filter(({ index }) => index < currentIdx);
    
    if (matches.length > 0) {
        selectTrack(matches[matches.length - 1].index);
    } else {
        selectTrack(state.filteredPlaylist[state.filteredPlaylist.length - 1].index);
    }
}

function updateFilterStatus() {
    let matchCount;
    if (state.viewMode === 'artist') {
        matchCount = state.filteredArtistItems.length;
    } else if (state.viewMode === 'folder') {
        matchCount = state.filteredFolderContents.length;
    } else {
        matchCount = state.filteredPlaylist.length;
    }
    
    if (state.filterText && matchCount > 0) {
        updateStatus(`${matchCount} matches`);
    } else if (state.filterText) {
        updateStatus('No matches');
    }
}
