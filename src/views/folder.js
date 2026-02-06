import { invoke, open } from '../tauri.js';
import { state, elements } from '../state.js';
import { escapeHtml, formatDuration } from '../utils.js';
import { updateStatus } from '../ui.js';
import { playTrack } from '../playback.js';
import { renderPlaylist } from './playlist.js';
import { scrollToFolderSelected } from '../navigation.js';

export async function openFolder() {
    try {
        const selected = await open({
            directory: true,
            multiple: false,
            title: 'Select Music Folder'
        });
        
        if (selected) {
            await loadFolder(selected);
        }
    } catch (err) {
        console.error('Failed to open folder:', err);
    }
}

export async function loadFolder(path) {
    try {
        updateStatus('Loading...');
        const tracks = await invoke('load_folder', { path });
        state.playlist = tracks;
        state.selectedIndex = 0;
        state.playingIndex = -1;
        state.rootFolder = path;
        state.currentFolder = path;
        state.viewMode = 'list';
        renderPlaylist();
        updateStatus(`Loaded ${tracks.length} tracks`);
    } catch (err) {
        console.error('Failed to load folder:', err);
        updateStatus(`Error: ${err}`);
    }
}

export async function reloadContent() {
    if (!state.rootFolder) {
        updateStatus('No folder loaded');
        return;
    }
    
    // If in library mode, rescan the library
    if (state.rootFolder === 'Library') {
        const { scanLibrary } = await import('../library.js');
        await scanLibrary();
        return;
    }
    
    const previousCount = state.playlist.length;
    const currentlyPlaying = state.playingIndex >= 0 ? state.playlist[state.playingIndex]?.path : null;
    
    try {
        updateStatus('Reloading...');
        const tracks = await invoke('load_folder', { path: state.rootFolder });
        state.playlist = tracks;
        
        // Try to restore playing index if track still exists
        if (currentlyPlaying) {
            const newIndex = tracks.findIndex(t => t.path === currentlyPlaying);
            state.playingIndex = newIndex; // -1 if not found
        }
        
        // Adjust selected index if needed
        if (state.selectedIndex >= tracks.length) {
            state.selectedIndex = Math.max(0, tracks.length - 1);
        }
        
        // If in folder view, also reload folder contents
        if (state.viewMode === 'folder') {
            await loadFolderContents(state.currentFolder);
        } else {
            renderPlaylist();
        }
        
        const diff = tracks.length - previousCount;
        const diffText = diff > 0 ? ` (+${diff})` : diff < 0 ? ` (${diff})` : '';
        updateStatus(`Reloaded: ${tracks.length} tracks${diffText}`);
    } catch (err) {
        console.error('Failed to reload:', err);
        updateStatus(`Error: ${err}`);
    }
}

// View Mode Toggle
export function toggleViewMode() {
    if (!state.rootFolder) {
        updateStatus('No folder loaded');
        return;
    }
    
    if (state.viewMode === 'list') {
        state.viewMode = 'folder';
        state.currentFolder = state.rootFolder;
        state.folderSelectedIndex = 0;
        loadFolderContents(state.currentFolder);
    } else {
        state.viewMode = 'list';
        state.selectedIndex = 0;
        renderPlaylist();
        updateStatus('List view');
    }
    updateViewModeIndicator();
}

export async function loadFolderContents(path) {
    try {
        const contents = await invoke('browse_folder', { 
            path, 
            rootPath: state.rootFolder 
        });
        state.folderContents = contents.items;
        state.currentFolder = contents.path;
        state.folderParent = contents.parent;
        state.folderSelectedIndex = 0;
        // Clear filter when navigating folders
        state.filterText = '';
        state.filteredFolderContents = [];
        elements.filterInput.value = '';
        renderFolderView();
        updateStatus(`Folder: ${getFolderName(path)}`);
    } catch (err) {
        console.error('Failed to load folder contents:', err);
        updateStatus(`Error: ${err}`);
    }
}

export function getFolderName(path) {
    return path.split(/[/\\]/).filter(Boolean).pop() || path;
}

export function buildBreadcrumb(currentPath, rootPath) {
    if (!rootPath || !currentPath) return '';
    
    // Normalize paths
    const normRoot = rootPath.replace(/\\/g, '/').replace(/\/$/, '');
    const normCurrent = currentPath.replace(/\\/g, '/').replace(/\/$/, '');
    
    if (normCurrent === normRoot) {
        return `<span class="breadcrumb-item">${getFolderName(normRoot)}</span>`;
    }
    
    // Build relative path
    const relative = normCurrent.slice(normRoot.length + 1);
    const parts = relative.split('/');
    
    let breadcrumb = `<span class="breadcrumb-item" data-path="${normRoot}">${getFolderName(normRoot)}</span>`;
    
    let currentBuildPath = normRoot;
    for (let i = 0; i < parts.length; i++) {
        currentBuildPath += '/' + parts[i];
        const isLast = i === parts.length - 1;
        breadcrumb += ` / <span class="${isLast ? '' : 'breadcrumb-item'}" ${isLast ? '' : `data-path="${currentBuildPath}"`}>${parts[i]}</span>`;
    }
    
    return breadcrumb;
}

export function renderFolderView() {
    if (state.folderContents.length === 0) {
        elements.playlist.innerHTML = `
            <div class="empty-playlist">
                <p>No music in this folder</p>
                <p class="hint">Press <kbd>Backspace</kbd> to go back</p>
            </div>
        `;
        elements.playlistCount.textContent = 'Empty folder';
        return;
    }
    
    const breadcrumbHtml = buildBreadcrumb(state.currentFolder, state.rootFolder);
    const visualSelection = state.mode === 'visual' && state.viewMode === 'folder' ? getVisualSelectionIndices() : new Set();
    
    const folderName = getFolderName(state.currentFolder);
    elements.playlistCount.textContent = `${folderName} (${state.folderContents.length} items)`;
    
    const itemsHtml = state.folderContents.map((item, index) => {
        const isSelected = index === state.folderSelectedIndex;
        const isInVisual = visualSelection.has(index);
        const isMatch = state.filterText && state.filteredFolderContents.some(fc => fc.index === index);
        const classes = ['track-item'];
        if (isSelected) classes.push('selected');
        if (isInVisual) classes.push('visual-selected');
        if (item.is_folder) classes.push('folder-item');
        if (isMatch) classes.push('match');
        
        const icon = item.is_folder 
            ? `<svg class="folder-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`
            : `<svg class="file-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>`;
        
        const info = item.is_folder 
            ? `<span class="track-count">${item.track_count} tracks</span>`
            : `<span class="track-duration">${formatDuration(item.duration)}</span>`;
        
        return `
            <div class="${classes.join(' ')}" data-index="${index}" data-path="${escapeHtml(item.path)}" data-is-folder="${item.is_folder}">
                <span class="track-number">${icon}</span>
                <span class="track-item-name">${escapeHtml(item.name)}</span>
                ${info}
            </div>
        `;
    }).join('');
    
    elements.playlist.innerHTML = `<div class="folder-breadcrumb">${breadcrumbHtml}</div>${itemsHtml}`;
    
    // Breadcrumb click handlers
    elements.playlist.querySelectorAll('.breadcrumb-item[data-path]').forEach(item => {
        item.addEventListener('click', () => {
            loadFolderContents(item.dataset.path);
        });
    });
    
    // Item click handlers
    elements.playlist.querySelectorAll('.track-item').forEach(item => {
        item.addEventListener('click', () => {
            state.folderSelectedIndex = parseInt(item.dataset.index);
            renderFolderView();
        });
        item.addEventListener('dblclick', () => {
            handleFolderItemAction(parseInt(item.dataset.index));
        });
    });
    
    scrollToFolderSelected();
}

export function handleFolderItemAction(index) {
    const item = state.folderContents[index];
    if (!item) return;
    
    if (item.is_folder) {
        loadFolderContents(item.path);
    } else {
        playFileFromFolder(item.path);
    }
}

export async function playFileFromFolder(filePath) {
    const playlistIdx = state.playlist.findIndex(t => t.path === filePath);
    if (playlistIdx !== -1) {
        playTrack(playlistIdx);
    } else {
        updateStatus('Track not in playlist');
    }
}

export function navigateFolderUp() {
    if (state.folderParent && state.currentFolder !== state.rootFolder) {
        loadFolderContents(state.folderParent);
    }
}

export function updateViewModeIndicator() {
    const indicator = state.viewMode === 'folder' ? 'FOLDER' : state.viewMode === 'artist' ? 'ARTIST' : 'LIST';
    // Update playlist title to show current view mode
    const title = document.querySelector('.playlist-title');
    if (title) {
        if (state.viewMode === 'artist') {
            title.textContent = state.artistViewMode === 'tracks' ? `Artist: ${state.currentArtist}` : 'Artists';
        } else {
            title.textContent = state.viewMode === 'folder' ? 'Browse' : 'Playlist';
        }
    }
}

export async function loadCurrentFolderAsPlaylist() {
    if (state.folderContents.length === 0) return;
    
    // Get all audio files from current folder
    const audioFiles = state.folderContents.filter(item => !item.is_folder);
    
    if (audioFiles.length === 0) {
        updateStatus('No audio files in this folder');
        return;
    }
    
    try {
        updateStatus('Loading folder...');
        const tracks = await invoke('load_folder', { path: state.currentFolder });
        state.playlist = tracks;
        state.selectedIndex = 0;
        state.playingIndex = -1;
        state.queue = [];
        state.viewMode = 'list';
        renderPlaylist();
        updateViewModeIndicator();
        updateStatus(`Loaded ${tracks.length} tracks from folder`);
    } catch (err) {
        console.error('Failed to load folder:', err);
        updateStatus(`Error: ${err}`);
    }
}

function getVisualSelectionIndices() {
    if (state.visualStart === -1) return new Set();
    const start = Math.min(state.visualStart, state.folderSelectedIndex);
    const end = Math.max(state.visualStart, state.folderSelectedIndex);
    const indices = new Set();
    for (let i = start; i <= end; i++) {
        indices.add(i);
    }
    return indices;
}
