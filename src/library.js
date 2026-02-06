import { invoke, open } from './tauri.js';
import { state, elements } from './state.js';
import { updateStatus, showLoading, hideLoading } from './ui.js';
import { renderPlaylist } from './views/playlist.js';

export async function getLibraryFolders() {
    try {
        return await invoke('get_library_folders');
    } catch (err) {
        console.error('Failed to get library folders:', err);
        return [];
    }
}

export async function addLibraryFolder() {
    try {
        const selected = await open({
            directory: true,
            multiple: false,
            title: 'Add Library Folder'
        });
        
        if (selected) {
            const folders = await invoke('add_library_folder', { folder: selected });
            updateStatus(`Library folder added (${folders.length} total)`);
            return folders;
        }
    } catch (err) {
        console.error('Failed to add library folder:', err);
    }
    return null;
}

export async function removeLibraryFolder(folder) {
    try {
        const folders = await invoke('remove_library_folder', { folder });
        updateStatus(`Library folder removed (${folders.length} remaining)`);
        return folders;
    } catch (err) {
        console.error('Failed to remove library folder:', err);
        return [];
    }
}

export async function scanLibrary() {
    try {
        const folders = await getLibraryFolders();
        if (folders.length === 0) {
            updateStatus('No library folders. Use :addlib to add folders');
            return;
        }
        
        showLoading(`Scanning ${folders.length} folder${folders.length > 1 ? 's' : ''}...`);
        
        let allTracks = [];
        for (let i = 0; i < folders.length; i++) {
            elements.loadingText.textContent = `Scanning folder ${i + 1}/${folders.length}...`;
            try {
                const tracks = await invoke('scan_library_folder', { folder: folders[i] });
                allTracks = allTracks.concat(tracks);
            } catch (err) {
                console.warn(`Failed to scan ${folders[i]}:`, err);
            }
        }
        
        hideLoading();
        
        // Remove duplicates by path
        const seen = new Set();
        allTracks = allTracks.filter(track => {
            if (seen.has(track.path)) return false;
            seen.add(track.path);
            return true;
        });
        
        // Sort by name and update indices
        allTracks.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
        allTracks.forEach((track, i) => track.index = i);
        
        // Update backend playlist with the paths
        const paths = allTracks.map(t => t.path);
        await invoke('set_playlist', { paths });
        
        state.playlist = allTracks;
        state.selectedIndex = 0;
        state.viewMode = 'list';
        state.rootFolder = 'Library';
        renderPlaylist();
        updateStatus(`Library: ${allTracks.length} tracks from ${folders.length} folder${folders.length > 1 ? 's' : ''}`);
    } catch (err) {
        hideLoading();
        console.error('Failed to scan library:', err);
        updateStatus('Failed to scan library');
    }
}

export async function showLibraryFolders() {
    const folders = await getLibraryFolders();
    if (folders.length === 0) {
        updateStatus('No library folders. Use :addlib to add folders');
    } else {
        const list = folders.map((f, i) => `${i + 1}. ${f}`).join('\n');
        updateStatus(`Library folders:\n${list}`);
    }
}
