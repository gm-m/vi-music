import { state } from './state.js';
import { closeModals, toggleHelp, updateStatus } from './ui.js';
import { getKeyString, getKeyAction } from './keybindings.js';
import { moveSelection, goToTop, goToBottom, selectTrack, scrollToSelected, goToPlayingTrack, centerSelection, scrollSelectionTop, scrollSelectionBottom, moveTrackDown, moveTrackUp, findNextArtist, findPrevArtist, navBack } from './navigation.js';
import { playSelected, togglePause, stop, nextTrack, prevTrack, adjustVolume, toggleMute, changeSpeed, resetSpeed, seekRelative, toggleRepeat, toggleShuffle, seekToStart, seekToEnd } from './playback.js';
import { enterCommandMode, goBack, revealInExplorer } from './commands.js';
import { enterFilterMode, clearFilter, jumpToNextMatch, jumpToPrevMatch } from './filter.js';
import { enterVisualMode, handleVisualModeKeyDown, deleteSelectedTracks, deleteTrack, deleteToEnd, undoDelete, restoreLastVisualSelection } from './visual.js';
import { handleQueueViewKeyDown, addToQueue, addToQueueAndPlay, toggleQueueView } from './queue.js';
import { handlePlaylistManagerKeyDown, handleAddToPlaylistKeyDown, showPlaylistManager, showAddToPlaylistPicker, getSelectedTrackPaths } from './playlists.js';
import { handleArtistViewKeyDown } from './views/artist.js';
import { toggleViewMode, openFolder, reloadContent, navigateFolderUp } from './views/folder.js';
import { setBookmark, jumpToBookmark, setLoopA, setLoopB, clearLoop } from './features.js';
import { formatDuration } from './utils.js';

// Execute an action by name
export function executeAction(action, e) {
    // Get count from prefix (default 1)
    const count = parseInt(state.countPrefix) || 1;
    
    // Clear count prefix after using it
    const clearCount = () => { state.countPrefix = ''; };
    
    // Track repeatable actions (skip pending keys, mode changes, and help)
    const repeatableActions = [
        'moveDown', 'moveUp', 'pageDown', 'pageUp', 'fullPageDown', 'fullPageUp',
        'seekForward', 'seekBackward', 'seekForwardLarge', 'seekBackwardLarge',
        'volumeUp', 'volumeDown', 'speedUp', 'speedDown',
        'deleteTrack', 'deleteToEnd', 'moveTrackDown', 'moveTrackUp',
        'nextTrack', 'prevTrack', 'findNextArtist', 'findPrevArtist',
    ];
    if (repeatableActions.includes(action)) {
        state.lastAction = { action, count };
    }
    
    switch (action) {
        // Navigation (with count support)
        case 'moveDown': moveSelection(count); clearCount(); return true;
        case 'moveUp': moveSelection(-count); clearCount(); return true;
        case 'pendingG': state.pendingKey = 'g'; return true;
        case 'goToEnd': 
            if (state.countPrefix) {
                // 5G goes to line 5
                selectTrack(Math.min(count - 1, state.playlist.length - 1));
            } else {
                goToBottom();
            }
            clearCount();
            return true;
        case 'goToTop': goToTop(); clearCount(); return true;
        case 'pageDown': e?.preventDefault(); moveSelection(10 * count); clearCount(); return true;
        case 'pageUp': e?.preventDefault(); moveSelection(-10 * count); clearCount(); return true;
        case 'fullPageDown': e?.preventDefault(); moveSelection(20 * count); clearCount(); return true;
        case 'fullPageUp': e?.preventDefault(); moveSelection(-20 * count); clearCount(); return true;
        case 'seekStart': clearCount(); seekToStart(); return true;
        case 'seekEnd': clearCount(); seekToEnd(); return true;
        case 'goToPlayingTrack': clearCount(); goToPlayingTrack(); return true;
        case 'centerSelection': clearCount(); centerSelection(); return true;
        case 'scrollSelectionTop': clearCount(); scrollSelectionTop(); return true;
        case 'scrollSelectionBottom': clearCount(); scrollSelectionBottom(); return true;
        case 'navBack': clearCount(); navBack(); return true;
        case 'goBack':
            clearCount();
            if (state.viewMode === 'folder') {
                navigateFolderUp();
            } else {
                goBack();
            }
            return true;
        case 'pendingZ': state.pendingKey = 'z'; return true;
        
        // Playback
        case 'playSelected': clearCount(); playSelected(); return true;
        case 'togglePause': e?.preventDefault(); clearCount(); togglePause(); return true;
        case 'stop': clearCount(); stop(); return true;
        case 'nextTrack': clearCount(); nextTrack(); return true;
        case 'prevTrack': clearCount(); prevTrack(); return true;
        
        // Volume
        case 'volumeUp': clearCount(); adjustVolume(state.settings.volumestep); return true;
        case 'volumeDown': clearCount(); adjustVolume(-state.settings.volumestep); return true;
        case 'toggleMute': clearCount(); toggleMute(); return true;
        
        // Speed
        case 'speedUp': clearCount(); changeSpeed(state.settings.speedstep); return true;
        case 'speedDown': clearCount(); changeSpeed(-state.settings.speedstep); return true;
        case 'speedReset': clearCount(); resetSpeed(); return true;
        
        // Seek (with count support)
        case 'seekForward': seekRelative(state.settings.seektime * count); clearCount(); return true;
        case 'seekBackward': seekRelative(-state.settings.seektime * count); clearCount(); return true;
        case 'seekForwardLarge': seekRelative(state.settings.seektimelarge * count); clearCount(); return true;
        case 'seekBackwardLarge': seekRelative(-state.settings.seektimelarge * count); clearCount(); return true;
        
        // Modes
        case 'commandMode': e?.preventDefault(); clearCount(); enterCommandMode(); return true;
        case 'filterMode': e?.preventDefault(); clearCount(); enterFilterMode(); return true;
        case 'normalMode':
            clearCount();
            if (state.filterText) clearFilter();
            else closeModals();
            return true;
        case 'visualMode': clearCount(); enterVisualMode(); return true;
        
        // View
        case 'toggleView': e?.preventDefault(); clearCount(); toggleViewMode(); return true;
        
        // Repeat/Shuffle
        case 'cycleRepeat': clearCount(); toggleRepeat(); return true;
        case 'toggleShuffle': clearCount(); toggleShuffle(); return true;
        
        // Queue
        case 'addToQueue': clearCount(); addToQueue(); return true;
        case 'addToQueueAndPlay': clearCount(); addToQueueAndPlay(); return true;
        case 'toggleQueueView': clearCount(); toggleQueueView(); return true;
        
        // Folder
        case 'openFolder': clearCount(); openFolder(); return true;
        case 'reloadContent': clearCount(); reloadContent(); return true;
        
        // Playlist
        case 'openPlaylistManager': clearCount(); showPlaylistManager(); return true;
        case 'addToPlaylist': clearCount(); showAddToPlaylistPicker(getSelectedTrackPaths()); return true;
        
        // Help
        case 'toggleHelp': clearCount(); toggleHelp(); return true;
        
        // Pending keys
        case 'pendingD': state.pendingKey = 'd'; return true;
        case 'pendingM': state.pendingKey = 'm'; return true;
        case 'pendingQuote': state.pendingKey = "'"; return true;
        
        // Delete
        case 'deleteTrack': clearCount(); deleteTrack(); return true;
        case 'deleteToEnd': clearCount(); deleteToEnd(); return true;
        case 'undoDelete': clearCount(); undoDelete(); return true;
        
        // Yank (copy path to clipboard)
        case 'yankPath': clearCount(); yankPath(); return true;
        
        // Reorder
        case 'moveTrackDown': clearCount(); moveTrackDown(); return true;
        case 'moveTrackUp': clearCount(); moveTrackUp(); return true;
        
        // Repeat last action
        case 'repeatLast': clearCount(); repeatLast(); return true;
        
        // Info
        case 'showTrackInfo': clearCount(); showTrackInfo(); return true;
        case 'showNowPlayingInfo': clearCount(); showNowPlayingInfo(); return true;
        case 'findNextArtist': clearCount(); findNextArtist(); return true;
        case 'findPrevArtist': clearCount(); findPrevArtist(); return true;
        
        // A-B Loop
        case 'setLoopA': clearCount(); setLoopA(); return true;
        case 'setLoopB': clearCount(); setLoopB(); return true;
        case 'clearLoop': clearCount(); clearLoop(); return true;
        
        default: clearCount(); return false;
    }
}

// Main keyboard handler
export function handleKeyDown(e) {
    // Ignore if typing in command or filter input
    if (state.mode === 'command' || state.mode === 'filter') {
        return;
    }
    
    // Queue view has its own key handling
    if (state.queueViewOpen) {
        handleQueueViewKeyDown(e);
        return;
    }
    
    // Playlist manager has its own key handling
    if (state.playlistManagerOpen) {
        handlePlaylistManagerKeyDown(e);
        return;
    }
    
    // Add to playlist picker has its own key handling
    if (state.addToPlaylistOpen) {
        handleAddToPlaylistKeyDown(e);
        return;
    }
    
    // Artist view has its own key handling
    if (state.viewMode === 'artist') {
        handleArtistViewKeyDown(e);
        return;
    }
    
    // Visual mode has its own key handling
    if (state.mode === 'visual') {
        handleVisualModeKeyDown(e);
        return;
    }
    
    // Handle count prefix (e.g., 3j, 5k, 10G)
    if (/^[0-9]$/.test(e.key) && state.pendingKey === null) {
        // Don't start with 0 (0 could be used for other things)
        if (state.countPrefix !== '' || e.key !== '0') {
            state.countPrefix += e.key;
            return;
        }
    }
    
    // Handle multi-key commands
    if (state.pendingKey === 'g') {
        if (e.key === 'g') {
            const count = parseInt(state.countPrefix) || 1;
            if (state.countPrefix) {
                // 5gg goes to line 5
                selectTrack(Math.min(count - 1, state.playlist.length - 1));
            } else {
                goToTop();
            }
        } else if (e.key === 'f') {
            revealInExplorer();
        } else if (e.key === 'v') {
            restoreLastVisualSelection();
        }
        state.pendingKey = null;
        state.countPrefix = '';
        return;
    }
    
    if (state.pendingKey === 'd') {
        if (e.key === 'd') {
            // dd - delete selected track(s) from playlist
            if (state.viewMode === 'list') {
                deleteSelectedTracks();
            }
        }
        state.pendingKey = null;
        state.countPrefix = '';
        return;
    }
    
    if (state.pendingKey === "'") {
        // 'a - jump to bookmark a
        if (/[a-z]/i.test(e.key)) {
            jumpToBookmark(e.key.toLowerCase());
        }
        state.pendingKey = null;
        state.countPrefix = '';
        return;
    }
    
    if (state.pendingKey === 'm') {
        // ma - set bookmark a (alternative to :mark a)
        if (/[a-z]/i.test(e.key)) {
            setBookmark(e.key.toLowerCase());
        }
        state.pendingKey = null;
        state.countPrefix = '';
        return;
    }
    
    if (state.pendingKey === 'z') {
        // zz - center selection, zt - top, zb - bottom
        if (e.key === 'z') {
            centerSelection();
        } else if (e.key === 't') {
            scrollSelectionTop();
        } else if (e.key === 'b') {
            scrollSelectionBottom();
        }
        state.pendingKey = null;
        state.countPrefix = '';
        return;
    }
    
    // Handle filter navigation first (n/N for next/prev match when filter is active)
    if (state.filterText) {
        if (e.key === 'n') {
            jumpToNextMatch();
            return;
        }
        if (e.key === 'N') {
            jumpToPrevMatch();
            return;
        }
    }
    
    // Try configurable keybindings
    const keyString = getKeyString(e);
    const action = getKeyAction(keyString);
    if (action && executeAction(action, e)) {
        return;
    }
    
    // Also try just the key for simple bindings
    const simpleAction = getKeyAction(e.key);
    if (simpleAction && executeAction(simpleAction, e)) {
        return;
    }
}

// Yank (copy track path to clipboard)
async function yankPath() {
    let path = null;
    if (state.viewMode === 'folder') {
        const item = state.folderContents[state.folderSelectedIndex];
        path = item?.path;
    } else if (state.viewMode === 'artist') {
        if (state.artistViewMode === 'tracks') {
            path = state.artistTracks[state.artistSelectedIndex]?.path;
        }
    } else {
        path = state.playlist[state.selectedIndex]?.path;
    }
    
    if (!path) {
        updateStatus('No track selected to yank');
        return;
    }
    
    try {
        await navigator.clipboard.writeText(path);
        updateStatus(`Yanked: ${path}`);
    } catch {
        updateStatus(`Yanked (clipboard unavailable): ${path}`);
    }
}

// Show info about selected track
async function showTrackInfo() {
    let track = null;
    if (state.viewMode === 'folder') {
        const item = state.folderContents[state.folderSelectedIndex];
        if (item && !item.is_folder) {
            track = { name: item.name, path: item.path, duration: item.duration };
        }
    } else if (state.viewMode === 'artist') {
        if (state.artistViewMode === 'tracks') {
            track = state.artistTracks[state.artistSelectedIndex];
        }
    } else {
        track = state.playlist[state.selectedIndex];
    }
    
    if (!track) {
        updateStatus('No track selected');
        return;
    }
    
    let info = `${track.name}`;
    if (track.duration) info += ` | ${formatDuration(track.duration)}`;
    if (track.path) info += ` | ${track.path}`;
    updateStatus(info);
}

// Show info about currently playing track
function showNowPlayingInfo() {
    if (state.playingIndex < 0 || !state.isPlaying) {
        updateStatus('No track playing');
        return;
    }
    
    const track = state.playlist[state.playingIndex];
    if (!track) return;
    
    const pos = formatDuration(state.elapsed);
    const dur = formatDuration(state.duration);
    const speed = state.speed !== 1.0 ? ` @ ${state.speed.toFixed(2)}x` : '';
    updateStatus(`${track.name} | ${pos}/${dur}${speed} | vol ${Math.round(state.volume * 100)}%`);
}

// Repeat last action
function repeatLast() {
    if (!state.lastAction) {
        updateStatus('No previous action to repeat');
        return;
    }
    
    const { action, count } = state.lastAction;
    state.countPrefix = String(count);
    executeAction(action);
    state.countPrefix = '';
}
