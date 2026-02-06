import { invoke } from './tauri.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { updateStatus } from './ui.js';
import { renderPlaylist } from './views/playlist.js';

export async function savePlaylist(name) {
    if (state.playlist.length === 0) {
        updateStatus('No tracks to save');
        return;
    }
    
    try {
        // Check if playlist already exists
        const playlists = await invoke('list_playlists');
        const exists = playlists.some(p => p.name.toLowerCase() === name.toLowerCase());
        
        if (exists && !confirm(`Playlist "${name}" already exists. Overwrite?`)) {
            updateStatus('Save cancelled');
            return;
        }
        
        await invoke('save_playlist', { name });
        updateStatus(`Playlist "${name}" saved (${state.playlist.length} tracks)`);
    } catch (err) {
        console.error('Failed to save playlist:', err);
        updateStatus(`Error: ${err}`);
    }
}

export async function loadSavedPlaylist(name) {
    try {
        updateStatus('Loading playlist...');
        const tracks = await invoke('load_playlist', { name });
        
        // Store previous folder for :back command
        if (state.rootFolder) {
            state.previousRootFolder = state.rootFolder;
        }
        
        state.playlist = tracks;
        state.selectedIndex = 0;
        state.playingIndex = -1;
        state.viewMode = 'list';
        state.rootFolder = `Playlist: ${name}`;
        renderPlaylist();
        updateStatus(`Loaded "${name}" (${tracks.length} tracks)`);
    } catch (err) {
        console.error('Failed to load playlist:', err);
        updateStatus(`Error: ${err}`);
    }
}

export async function renamePlaylist(oldName, newName) {
    try {
        await invoke('rename_playlist', { oldName, newName });
        updateStatus(`Playlist renamed: "${oldName}" → "${newName}"`);
        if (state.playlistManagerOpen) {
            refreshPlaylistManager();
        }
        // Update rootFolder if we're viewing the renamed playlist
        if (state.rootFolder === `Playlist: ${oldName}`) {
            state.rootFolder = `Playlist: ${newName}`;
        }
    } catch (err) {
        console.error('Failed to rename playlist:', err);
        updateStatus(`Error: ${err}`);
    }
}

export async function deletePlaylist(name) {
    try {
        await invoke('delete_playlist', { name });
        updateStatus(`Playlist "${name}" deleted`);
        if (state.playlistManagerOpen) {
            refreshPlaylistManager();
        }
    } catch (err) {
        console.error('Failed to delete playlist:', err);
        updateStatus(`Error: ${err}`);
    }
}

export async function showPlaylistManager() {
    try {
        const playlists = await invoke('list_playlists');
        state.savedPlaylists = playlists;
        state.playlistManagerOpen = true;
        state.playlistManagerIndex = 0;
        renderPlaylistManager();
    } catch (err) {
        console.error('Failed to list playlists:', err);
        updateStatus(`Error: ${err}`);
    }
}

export async function refreshPlaylistManager() {
    try {
        const playlists = await invoke('list_playlists');
        state.savedPlaylists = playlists;
        state.playlistManagerIndex = Math.min(state.playlistManagerIndex, Math.max(0, playlists.length - 1));
        renderPlaylistManager();
    } catch (err) {
        console.error('Failed to refresh playlists:', err);
    }
}

export function renderPlaylistManager() {
    const modal = document.getElementById('playlistManagerModal');
    const list = document.getElementById('playlistManagerList');
    
    if (state.savedPlaylists.length === 0) {
        list.innerHTML = `
            <div class="empty-playlist">
                <p>No saved playlists</p>
                <p class="hint">Use <kbd>:save name</kbd> to save current playlist</p>
            </div>
        `;
    } else {
        list.innerHTML = state.savedPlaylists.map((pl, index) => {
            const isSelected = index === state.playlistManagerIndex;
            const classes = ['playlist-manager-item'];
            if (isSelected) classes.push('selected');
            
            return `
                <div class="${classes.join(' ')}" data-index="${index}">
                    <span class="playlist-manager-name">${escapeHtml(pl.name)}</span>
                    <span class="playlist-manager-count">${pl.track_count} tracks</span>
                </div>
            `;
        }).join('');
        
        list.querySelectorAll('.playlist-manager-item').forEach(item => {
            item.addEventListener('click', () => {
                state.playlistManagerIndex = parseInt(item.dataset.index);
                renderPlaylistManager();
            });
            item.addEventListener('dblclick', () => {
                loadSelectedPlaylist();
            });
        });
    }
    
    modal.classList.add('visible');
    
    const selected = list.querySelector('.playlist-manager-item.selected');
    if (selected) {
        selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

export function closePlaylistManager() {
    state.playlistManagerOpen = false;
    document.getElementById('playlistManagerModal').classList.remove('visible');
}

export function loadSelectedPlaylist() {
    if (state.savedPlaylists.length === 0) return;
    const playlist = state.savedPlaylists[state.playlistManagerIndex];
    closePlaylistManager();
    loadSavedPlaylist(playlist.name);
}

export function deleteSelectedPlaylist() {
    if (state.savedPlaylists.length === 0) return;
    const playlist = state.savedPlaylists[state.playlistManagerIndex];
    if (confirm(`Delete playlist "${playlist.name}"?`)) {
        deletePlaylist(playlist.name);
    }
}

export function handlePlaylistManagerKeyDown(e) {
    switch (e.key) {
        case 'j':
            e.preventDefault();
            if (state.playlistManagerIndex < state.savedPlaylists.length - 1) {
                state.playlistManagerIndex++;
                renderPlaylistManager();
            }
            break;
        case 'k':
            e.preventDefault();
            if (state.playlistManagerIndex > 0) {
                state.playlistManagerIndex--;
                renderPlaylistManager();
            }
            break;
        case 'g':
            if (state.pendingKey === 'g') {
                state.playlistManagerIndex = 0;
                renderPlaylistManager();
                state.pendingKey = null;
            } else {
                state.pendingKey = 'g';
            }
            break;
        case 'G':
            state.playlistManagerIndex = Math.max(0, state.savedPlaylists.length - 1);
            renderPlaylistManager();
            break;
        case 'Enter':
            e.preventDefault();
            loadSelectedPlaylist();
            break;
        case 'd':
            if (state.pendingKey === 'd') {
                deleteSelectedPlaylist();
                state.pendingKey = null;
            } else {
                state.pendingKey = 'd';
            }
            break;
        case 'Escape':
        case 'q':
            e.preventDefault();
            closePlaylistManager();
            break;
    }
}

// Get selected track paths based on current view mode
export function getSelectedTrackPaths(indices = null) {
    if (state.viewMode === 'folder') {
        // In folder view, get paths from folder contents
        if (indices) {
            return indices
                .map(i => state.folderContents[i])
                .filter(item => item && !item.is_folder)
                .map(item => item.path);
        }
        // Single selection
        const item = state.folderContents[state.folderSelectedIndex];
        if (item && !item.is_folder) {
            return [item.path];
        }
        return [];
    } else {
        // In list view, get paths from playlist
        if (indices) {
            return indices.map(i => state.playlist[i]?.path).filter(Boolean);
        }
        const track = state.playlist[state.selectedIndex];
        return track ? [track.path] : [];
    }
}

// Add to Playlist Picker
export async function showAddToPlaylistPicker(trackPaths) {
    if (!trackPaths || trackPaths.length === 0) {
        updateStatus('No tracks selected');
        return;
    }
    
    // Filter out any invalid paths
    state.addToPlaylistTracks = trackPaths.filter(Boolean);
    
    if (state.addToPlaylistTracks.length === 0) {
        updateStatus('No valid tracks selected');
        return;
    }
    
    try {
        const playlists = await invoke('list_playlists');
        state.savedPlaylists = playlists;
        state.addToPlaylistOpen = true;
        state.addToPlaylistIndex = 0;
        
        // Exit visual mode if active
        if (state.mode === 'visual') {
            state.mode = 'normal';
            state.visualStart = -1;
        }
        
        renderAddToPlaylistPicker();
    } catch (err) {
        console.error('Failed to list playlists:', err);
        updateStatus(`Error: ${err}`);
    }
}

export function renderAddToPlaylistPicker() {
    const modal = document.getElementById('addToPlaylistModal');
    const list = document.getElementById('addToPlaylistList');
    const countEl = document.getElementById('addToPlaylistCount');
    
    countEl.textContent = `${state.addToPlaylistTracks.length} track${state.addToPlaylistTracks.length > 1 ? 's' : ''} selected`;
    
    // Build list with "New Playlist" option at top
    let html = `
        <div class="add-to-playlist-item new-playlist ${state.addToPlaylistIndex === 0 ? 'selected' : ''}" data-index="0">
            <span class="add-to-playlist-icon">+</span>
            <span class="add-to-playlist-name">New Playlist...</span>
        </div>
    `;
    
    html += state.savedPlaylists.map((pl, index) => {
        const isSelected = index + 1 === state.addToPlaylistIndex;
        const classes = ['add-to-playlist-item'];
        if (isSelected) classes.push('selected');
        
        return `
            <div class="${classes.join(' ')}" data-index="${index + 1}">
                <span class="add-to-playlist-icon">♫</span>
                <span class="add-to-playlist-name">${escapeHtml(pl.name)}</span>
                <span class="add-to-playlist-count">${pl.track_count} tracks</span>
            </div>
        `;
    }).join('');
    
    list.innerHTML = html;
    
    list.querySelectorAll('.add-to-playlist-item').forEach(item => {
        item.addEventListener('click', () => {
            state.addToPlaylistIndex = parseInt(item.dataset.index);
            renderAddToPlaylistPicker();
        });
        item.addEventListener('dblclick', () => {
            confirmAddToPlaylist();
        });
    });
    
    modal.classList.add('visible');
    
    const selected = list.querySelector('.add-to-playlist-item.selected');
    if (selected) {
        selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

export function closeAddToPlaylistPicker() {
    state.addToPlaylistOpen = false;
    state.addToPlaylistTracks = [];
    document.getElementById('addToPlaylistModal').classList.remove('visible');
}

export async function confirmAddToPlaylist() {
    if (state.addToPlaylistIndex === 0) {
        // New playlist - prompt for name
        closeAddToPlaylistPicker();
        const name = prompt('Enter playlist name:');
        if (name && name.trim()) {
            await addTracksToPlaylistByName(name.trim());
        }
    } else {
        // Existing playlist
        const playlist = state.savedPlaylists[state.addToPlaylistIndex - 1];
        await addTracksToPlaylistByName(playlist.name);
        closeAddToPlaylistPicker();
    }
}

export async function addTracksToPlaylistByName(name) {
    try {
        const added = await invoke('add_tracks_to_playlist', { 
            name, 
            tracks: state.addToPlaylistTracks 
        });
        updateStatus(`Added ${added} track${added !== 1 ? 's' : ''} to "${name}"`);
    } catch (err) {
        console.error('Failed to add tracks to playlist:', err);
        updateStatus(`Error: ${err}`);
    }
}

export function handleAddToPlaylistKeyDown(e) {
    const totalItems = state.savedPlaylists.length + 1; // +1 for "New Playlist"
    
    switch (e.key) {
        case 'j':
            e.preventDefault();
            if (state.addToPlaylistIndex < totalItems - 1) {
                state.addToPlaylistIndex++;
                renderAddToPlaylistPicker();
            }
            break;
        case 'k':
            e.preventDefault();
            if (state.addToPlaylistIndex > 0) {
                state.addToPlaylistIndex--;
                renderAddToPlaylistPicker();
            }
            break;
        case 'g':
            if (state.pendingKey === 'g') {
                state.addToPlaylistIndex = 0;
                renderAddToPlaylistPicker();
                state.pendingKey = null;
            } else {
                state.pendingKey = 'g';
            }
            break;
        case 'G':
            state.addToPlaylistIndex = totalItems - 1;
            renderAddToPlaylistPicker();
            break;
        case 'Enter':
            e.preventDefault();
            confirmAddToPlaylist();
            break;
        case 'Escape':
        case 'q':
            e.preventDefault();
            closeAddToPlaylistPicker();
            break;
    }
}
