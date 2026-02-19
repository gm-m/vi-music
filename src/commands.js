import { state, elements } from './state.js';
import { updateStatus, updateModeIndicators, toggleHelp } from './ui.js';
import { playTrack, playSelected, togglePause, stop, nextTrack, prevTrack, setVolume, seekTo, jumpToPercent } from './playback.js';
import { openFolder, loadFolder, reloadContent } from './views/folder.js';
import { openArtistView } from './views/artist.js';
import { renderPlaylist } from './views/playlist.js';
import { moveSelectionRelative } from './navigation.js';
import { handleSetCommand, showCurrentSettings } from './settings.js';
import { setSleepTimer, adjustSleepTimer, setBookmark, showBookmarks, deleteBookmark } from './features.js';
import { getLibraryFolders, addLibraryFolder, removeLibraryFolder, scanLibrary, showLibraryFolders } from './library.js';
import { showAudioDevices, setAudioDevice, setAudioDeviceByIndex } from './devices.js';
import { savePlaylist, loadSavedPlaylist, renamePlaylist, deletePlaylist, showPlaylistManager } from './playlists.js';
import { deleteTrackRange } from './visual.js';
import { invoke, open } from './tauri.js';

// Command Mode
export function enterCommandMode() {
    state.mode = 'command';
    elements.modeIndicator.textContent = 'COMMAND';
    elements.modeIndicator.classList.add('command');
    elements.helpBar.style.display = 'none';
    elements.commandLine.style.display = 'flex';
    elements.commandInput.value = '';
    elements.commandInput.focus();
}

export function exitCommandMode() {
    state.mode = 'normal';
    updateModeIndicators();
    elements.modeIndicator.classList.remove('command');
    elements.helpBar.style.display = 'flex';
    elements.commandLine.style.display = 'none';
}

export function handleCommandInput(e) {
    e.stopPropagation();
    if (e.key === 'Enter') {
        e.preventDefault();
        executeCommand(elements.commandInput.value);
        exitCommandMode();
    } else if (e.key === 'Escape') {
        e.preventDefault();
        exitCommandMode();
    }
}

export function executeCommand(cmd) {
    const trimmed = cmd.trim();
    
    // Check for range commands like :10,20d
    const rangeMatch = trimmed.match(/^(\d+),(\d+)([a-z]+)$/i);
    if (rangeMatch) {
        const start = parseInt(rangeMatch[1]);
        const end = parseInt(rangeMatch[2]);
        const action = rangeMatch[3].toLowerCase();
        
        if (action === 'd' || action === 'delete') {
            deleteTrackRange(start, end);
            return;
        }
    }
    
    // Check for single line command like :10d
    const singleMatch = trimmed.match(/^(\d+)([a-z]+)$/i);
    if (singleMatch) {
        const line = parseInt(singleMatch[1]);
        const action = singleMatch[2].toLowerCase();
        
        if (action === 'd' || action === 'delete') {
            deleteTrackRange(line, line);
            return;
        }
    }
    
    const parts = trimmed.toLowerCase().split(/\s+/);
    const command = parts[0];
    
    switch (command) {
        case 'q':
        case 'quit':
            window.close();
            break;
        case 'open':
        case 'o':
            openFolder();
            break;
        case 'reload':
        case 'r':
            reloadContent();
            break;
        case 'play':
        case 'p':
            if (parts[1]) {
                const index = parseInt(parts[1]) - 1;
                if (index >= 0 && index < state.playlist.length) {
                    playTrack(index);
                }
            } else {
                playSelected();
            }
            break;
        case 'stop':
            stop();
            break;
        case 'next':
        case 'n':
            nextTrack();
            break;
        case 'prev':
            prevTrack();
            break;
        case 'vol':
        case 'volume':
            if (parts[1]) {
                const vol = parseInt(parts[1]) / 100;
                setVolume(vol);
            }
            break;
        case 'help':
        case 'h':
            toggleHelp();
            break;
        case 'setdefault':
        case 'sd':
            setDefaultFolder();
            break;
        case 'cleardefault':
        case 'cd':
            clearDefaultFolder();
            break;
        case 'save':
        case 'w':
            if (parts[1]) {
                savePlaylist(parts.slice(1).join(' '));
            } else {
                updateStatus('Usage: :save <playlist name>');
            }
            break;
        case 'load':
        case 'e':
            if (parts[1]) {
                loadSavedPlaylist(parts.slice(1).join(' '));
            } else {
                showPlaylistManager();
            }
            break;
        case 'playlists':
        case 'pl':
            showPlaylistManager();
            break;
        case 'delplaylist':
        case 'dp':
            if (parts[1]) {
                deletePlaylist(parts.slice(1).join(' '));
            } else {
                updateStatus('Usage: :delplaylist <playlist name>');
            }
            break;
        case 'rename':
        case 'rn':
            if (parts[1] && parts[2]) {
                // Find the separator between old and new name
                const restArgs = parts.slice(1).join(' ');
                // Support "oldname newname" or "oldname > newname"
                let oldName, newName;
                if (restArgs.includes('>')) {
                    [oldName, newName] = restArgs.split('>').map(s => s.trim());
                } else {
                    // Assume first word is old name, rest is new name
                    oldName = parts[1];
                    newName = parts.slice(2).join(' ');
                }
                if (oldName && newName) {
                    renamePlaylist(oldName, newName);
                } else {
                    updateStatus('Usage: :rename <old name> > <new name>');
                }
            } else {
                updateStatus('Usage: :rename <old name> > <new name>');
            }
            break;
        case 'sleep':
            if (parts[1]) {
                const arg = parts[1];
                // Check for +N or -N syntax to add/subtract time
                if (arg.startsWith('+') || arg.startsWith('-')) {
                    const delta = parseInt(arg);
                    if (!isNaN(delta)) {
                        adjustSleepTimer(delta);
                    } else {
                        updateStatus('Usage: :sleep +<minutes> or :sleep -<minutes>');
                    }
                } else {
                    const minutes = parseInt(arg);
                    if (!isNaN(minutes) && minutes >= 0) {
                        setSleepTimer(minutes);
                    } else {
                        updateStatus('Usage: :sleep <minutes> (0 to cancel)');
                    }
                }
            } else {
                // Show current timer status
                if (state.sleepTimerEnd) {
                    const remaining = Math.ceil((state.sleepTimerEnd - Date.now()) / 60000);
                    updateStatus(`Sleep timer: ${remaining} minute${remaining !== 1 ? 's' : ''} remaining`);
                } else {
                    updateStatus('No sleep timer set. Usage: :sleep <minutes>');
                }
            }
            break;
        case 'mark':
            if (parts[1] && parts[1].length === 1 && /[a-z]/i.test(parts[1])) {
                setBookmark(parts[1].toLowerCase());
            } else {
                updateStatus('Usage: :mark <a-z>');
            }
            break;
        case 'marks':
            showBookmarks();
            break;
        case 'delmark':
        case 'dm':
            if (parts[1] && parts[1].length === 1 && /[a-z]/i.test(parts[1])) {
                deleteBookmark(parts[1].toLowerCase());
            } else {
                updateStatus('Usage: :delmark <a-z>');
            }
            break;
        case 'jump':
        case 'j':
            if (parts[1]) {
                const jumpArg = parts[1].trim();
                // Check for time format (m:ss or h:mm:ss)
                if (jumpArg.includes(':')) {
                    const timeParts = jumpArg.split(':').map(Number);
                    let seconds = 0;
                    if (timeParts.some(isNaN)) {
                        updateStatus('Invalid time format. Use m:ss or h:mm:ss');
                    } else if (timeParts.length === 2) {
                        // m:ss
                        seconds = timeParts[0] * 60 + timeParts[1];
                        seekTo(seconds);
                    } else if (timeParts.length === 3) {
                        // h:mm:ss
                        seconds = timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2];
                        seekTo(seconds);
                    } else {
                        updateStatus('Invalid time format. Use m:ss or h:mm:ss');
                    }
                } else {
                    // Percentage jump
                    const percent = parseInt(jumpArg.replace('%', ''));
                    if (!isNaN(percent) && percent >= 0 && percent <= 100) {
                        jumpToPercent(percent);
                    } else {
                        updateStatus('Usage: :jump <0-100> or :jump m:ss');
                    }
                }
            } else {
                updateStatus('Usage: :jump <0-100> or :jump m:ss');
            }
            break;
        case 'addlib':
        case 'al':
            addLibraryFolder();
            break;
        case 'libs':
        case 'library':
            showLibraryFolders();
            break;
        case 'removelib':
        case 'rl':
            if (parts[1]) {
                const index = parseInt(parts[1]) - 1;
                getLibraryFolders().then(folders => {
                    if (index >= 0 && index < folders.length) {
                        removeLibraryFolder(folders[index]);
                    } else {
                        updateStatus('Invalid folder number. Use :libs to see folders');
                    }
                });
            } else {
                updateStatus('Usage: :removelib <number> (use :libs to see folders)');
            }
            break;
        case 'scanlib':
        case 'scan':
        case 'sl':
            scanLibrary();
            break;
        case 'back':
        case 'b':
            goBack();
            break;
        case 'artists':
        case 'ar':
            openArtistView();
            break;
        case 'devices':
        case 'dev':
            showAudioDevices();
            break;
        case 'device':
        case 'd':
            if (parts[1]) {
                const deviceNum = parseInt(parts[1]);
                if (!isNaN(deviceNum)) {
                    setAudioDeviceByIndex(deviceNum - 1);
                } else {
                    // Treat as device name
                    setAudioDevice(parts.slice(1).join(' '));
                }
            } else {
                showAudioDevices();
            }
            break;
        case 'reveal':
        case 'rv':
            revealInExplorer();
            break;
        case 'sort':
            if (parts[1]) {
                sortPlaylist(parts[1]);
            } else {
                updateStatus('Usage: :sort name | duration | path (append ! to reverse)');
            }
            break;
        case 'set':
            if (parts[1]) {
                handleSetCommand(parts.slice(1).join(' '));
            } else {
                showCurrentSettings();
            }
            break;
    }
    
    // Handle relative jump: +N or -N
    if (/^[+-]\d+$/.test(cmd)) {
        const offset = parseInt(cmd);
        moveSelectionRelative(offset);
        return;
    }
}

async function setDefaultFolder() {
    try {
        const selected = await open({
            directory: true,
            multiple: false,
            title: 'Select Default Music Folder'
        });
        
        if (selected) {
            await invoke('set_default_folder', { path: selected });
            await loadFolder(selected);
            updateStatus('Default folder set');
        }
    } catch (err) {
        console.error('Failed to set default folder:', err);
    }
}

async function clearDefaultFolder() {
    try {
        await invoke('clear_default_folder');
        updateStatus('Default folder cleared');
    } catch (err) {
        console.error('Failed to clear default folder:', err);
    }
}

function sortPlaylist(field) {
    if (state.playlist.length === 0) {
        updateStatus('No tracks to sort');
        return;
    }
    
    const reverse = field.endsWith('!');
    const key = reverse ? field.slice(0, -1) : field;
    
    // Remember the currently playing track path so we can fix playingIndex after sort
    const playingPath = state.playingIndex >= 0 ? state.playlist[state.playingIndex]?.path : null;
    const selectedPath = state.playlist[state.selectedIndex]?.path;
    
    let compareFn;
    switch (key) {
        case 'name':
            compareFn = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
            break;
        case 'duration':
            compareFn = (a, b) => (a.duration || 0) - (b.duration || 0);
            break;
        case 'path':
            compareFn = (a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' });
            break;
        default:
            updateStatus(`Unknown sort field: ${key}. Use name, duration, or path`);
            return;
    }
    
    if (reverse) {
        const original = compareFn;
        compareFn = (a, b) => original(b, a);
    }
    
    state.playlist.sort(compareFn);
    
    // Restore playingIndex and selectedIndex by path
    if (playingPath) {
        state.playingIndex = state.playlist.findIndex(t => t.path === playingPath);
    }
    if (selectedPath) {
        state.selectedIndex = state.playlist.findIndex(t => t.path === selectedPath);
        if (state.selectedIndex < 0) state.selectedIndex = 0;
    }
    
    // Update queue indices (they reference playlist positions which have changed)
    // Clear queue since indices are now invalid
    if (state.queue.length > 0) {
        state.queue = [];
        updateStatus(`Sorted by ${key}${reverse ? ' (reversed)' : ''} — queue cleared`);
    } else {
        updateStatus(`Sorted by ${key}${reverse ? ' (reversed)' : ''}`);
    }
    
    renderPlaylist();
}

export async function revealInExplorer() {
    let path = null;
    
    if (state.viewMode === 'list') {
        const track = state.filteredPlaylist.length > 0
            ? state.filteredPlaylist[state.selectedIndex]
            : state.playlist[state.selectedIndex];
        path = track?.path;
    } else if (state.viewMode === 'folder') {
        const contents = state.filteredFolderContents.length > 0
            ? state.filteredFolderContents
            : state.folderContents;
        const item = contents[state.folderSelectedIndex];
        path = item?.path;
    } else if (state.viewMode === 'artist') {
        if (state.artistViewMode === 'tracks') {
            const tracks = state.filteredArtistItems.length > 0
                ? state.filteredArtistItems.map(f => state.artistTracks[f.index])
                : state.artistTracks;
            path = tracks[state.artistSelectedIndex]?.path;
        }
    }
    
    if (!path) {
        updateStatus('No track selected');
        return;
    }
    
    try {
        await invoke('reveal_in_explorer', { path });
        updateStatus(`Revealed: ${path.split(/[\\/]/).pop()}`);
    } catch (err) {
        updateStatus(`Failed to reveal: ${err}`);
    }
}

export async function goBack() {
    if (!state.previousRootFolder) {
        updateStatus('No previous folder to go back to');
        return;
    }
    
    const previous = state.previousRootFolder;
    state.previousRootFolder = state.rootFolder; // Allow going forward again
    
    if (previous === 'Library') {
        await scanLibrary();
    } else {
        await loadFolder(previous);
    }
}
