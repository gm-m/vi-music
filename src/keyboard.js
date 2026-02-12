import { state } from './state.js';
import { closeModals, toggleHelp } from './ui.js';
import { getKeyString, getKeyAction } from './keybindings.js';
import { moveSelection, goToTop, goToBottom, selectTrack, scrollToSelected } from './navigation.js';
import { playSelected, togglePause, stop, nextTrack, prevTrack, adjustVolume, toggleMute, changeSpeed, resetSpeed, seekRelative, toggleRepeat, toggleShuffle } from './playback.js';
import { enterCommandMode, goBack } from './commands.js';
import { enterFilterMode, clearFilter, jumpToNextMatch, jumpToPrevMatch } from './filter.js';
import { enterVisualMode, handleVisualModeKeyDown, deleteSelectedTracks } from './visual.js';
import { handleQueueViewKeyDown, addToQueue, toggleQueueView } from './queue.js';
import { handlePlaylistManagerKeyDown, handleAddToPlaylistKeyDown, showPlaylistManager, showAddToPlaylistPicker, getSelectedTrackPaths } from './playlists.js';
import { handleArtistViewKeyDown } from './views/artist.js';
import { toggleViewMode, openFolder, reloadContent, navigateFolderUp } from './views/folder.js';
import { setBookmark, jumpToBookmark, setLoopA, setLoopB, clearLoop } from './features.js';

// Execute an action by name
export function executeAction(action, e) {
    // Get count from prefix (default 1)
    const count = parseInt(state.countPrefix) || 1;
    
    // Clear count prefix after using it
    const clearCount = () => { state.countPrefix = ''; };
    
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
    
    // Handle remaining hardcoded keys
    switch (e.key) {
        case 'Backspace':
            e.preventDefault();
            if (state.viewMode === 'folder') {
                navigateFolderUp();
            } else {
                goBack();
            }
            break;
    }
}
