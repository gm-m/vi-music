import { state, elements } from './state.js';
import { renderPlaylist } from './views/playlist.js';
import { renderFolderView } from './views/folder.js';

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

export function scrollToSelected() {
    const selected = elements.playlist.querySelector('.track-item.selected');
    if (selected) {
        selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

export function scrollToFolderSelected() {
    const selected = elements.playlist.querySelector('.track-item.selected');
    if (selected) {
        selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
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
