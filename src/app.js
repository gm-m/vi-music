// Wait for Tauri to be ready
let invoke, open, listen;

if (window.__TAURI__) {
    invoke = window.__TAURI__.tauri?.invoke || window.__TAURI__.invoke;
    open = window.__TAURI__.dialog?.open;
    listen = window.__TAURI__.event?.listen;
} else {
    console.warn('Tauri API not available');
    invoke = async () => { throw new Error('Tauri not available'); };
    open = async () => null;
    listen = async () => () => {};
}

// Default keybindings - can be overridden by user config
const defaultKeybindings = {
    // Navigation
    'j': 'moveDown',
    'k': 'moveUp',
    'g': 'pendingG',
    'G': 'goToEnd',
    'Ctrl+d': 'pageDown',
    'Ctrl+u': 'pageUp',
    // Playback
    'Enter': 'playSelected',
    'Space': 'togglePause',
    's': 'stop',
    'n': 'nextTrack',
    'p': 'prevTrack',
    // Volume
    '+': 'volumeUp',
    '=': 'volumeUp',
    '-': 'volumeDown',
    'M': 'toggleMute',
    // Speed
    ']': 'speedUp',
    '[': 'speedDown',
    '\\': 'speedReset',
    // Seek
    'l': 'seekForward',
    'h': 'seekBackward',
    'L': 'seekForwardLarge',
    'H': 'seekBackwardLarge',
    // Modes
    ':': 'commandMode',
    '/': 'filterMode',
    'Escape': 'normalMode',
    'v': 'visualMode',
    // View
    'Tab': 'toggleView',
    // Repeat/Shuffle
    'r': 'cycleRepeat',
    'S': 'toggleShuffle',
    // Queue
    'a': 'addToQueue',
    'q': 'toggleQueueView',
    // Folder
    'o': 'openFolder',
    'R': 'reloadContent',
    // Playlist
    'P': 'openPlaylistManager',
    'A': 'addToPlaylist',
    // Help
    '?': 'toggleHelp',
    // Delete
    'd': 'pendingD',
    // Bookmarks
    'm': 'pendingM',
    "'": 'pendingQuote',
    // A-B Loop
    'b': 'setLoopA',
    'B': 'setLoopB',
    'C': 'clearLoop',
};

// User keybindings (loaded from config)
let userKeybindings = {};

// State
const state = {
    playlist: [],
    filteredPlaylist: [],
    filterText: '',
    selectedIndex: 0,
    playingIndex: -1,
    isPlaying: false,
    isPaused: false,
    volume: 1.0,
    previousVolume: 1.0,
    speed: 1.0,
    mode: 'normal', // 'normal' | 'command' | 'filter' | 'visual'
    pendingKey: null, // for multi-key commands like 'gg'
    visualStart: -1, // Start index for visual selection
    elapsed: 0,
    duration: null,
    progressInterval: null,
    repeatMode: 'off', // 'off' | 'one' | 'all'
    shuffleMode: false,
    shuffleHistory: [],
    shuffleIndex: -1,
    queue: [], // Array of playlist indices to play next
    queueViewOpen: false,
    queueSelectedIndex: 0,
    // Folder browsing
    viewMode: 'list', // 'list' | 'folder'
    rootFolder: null,
    currentFolder: null,
    folderContents: [],
    folderSelectedIndex: 0,
    filteredFolderContents: [],
    // Playlist manager
    playlistManagerOpen: false,
    playlistManagerIndex: 0,
    savedPlaylists: [],
    // Add to playlist picker
    addToPlaylistOpen: false,
    addToPlaylistIndex: 0,
    addToPlaylistTracks: [], // Track paths to add
    // Sleep timer
    sleepTimerEnd: null, // Timestamp when playback should stop
    sleepTimerInterval: null,
    // Bookmarks: { 'a': { track: 'path', position: seconds }, ... }
    bookmarks: {},
    // A-B Loop
    loopA: null, // Start position in seconds
    loopB: null, // End position in seconds
    loopInterval: null,
};

// DOM Elements
const elements = {
    modeIndicator: document.getElementById('modeIndicator'),
    trackName: document.getElementById('trackName'),
    trackStatus: document.getElementById('trackStatus'),
    trackArt: document.querySelector('.track-art'),
    playBtn: document.getElementById('playBtn'),
    playIcon: document.getElementById('playIcon'),
    pauseIcon: document.getElementById('pauseIcon'),
    prevBtn: document.getElementById('prevBtn'),
    nextBtn: document.getElementById('nextBtn'),
    stopBtn: document.getElementById('stopBtn'),
    volumeFill: document.getElementById('volumeFill'),
    volumeValue: document.getElementById('volumeValue'),
    playlist: document.getElementById('playlist'),
    playlistCount: document.getElementById('playlistCount'),
    helpBar: document.getElementById('helpBar'),
    commandLine: document.getElementById('commandLine'),
    commandInput: document.getElementById('commandInput'),
    filterLine: document.getElementById('filterLine'),
    filterInput: document.getElementById('filterInput'),
    helpModal: document.getElementById('helpModal'),
    progressBar: document.getElementById('progressBar'),
    progressFill: document.getElementById('progressFill'),
    timeElapsed: document.getElementById('timeElapsed'),
    timeTotal: document.getElementById('timeTotal'),
    queueModal: document.getElementById('queueModal'),
    queueList: document.getElementById('queueList'),
    speedIndicator: document.getElementById('speedIndicator'),
    sleepTimerIndicator: document.getElementById('sleepTimerIndicator'),
    loopIndicator: document.getElementById('loopIndicator'),
};

// Initialize
async function init() {
    await loadKeybindings();
    updateVolumeDisplay();
    setupEventListeners();
    setupMediaControlListener();
    await refreshStatus();
    startProgressUpdater();
    await loadDefaultFolder();
}

// Load user keybindings from config
async function loadKeybindings() {
    try {
        const json = await invoke('get_keybindings');
        userKeybindings = JSON.parse(json);
    } catch (err) {
        console.error('Failed to load keybindings:', err);
        userKeybindings = {};
    }
}

// Get the action for a key, checking user overrides first
function getKeyAction(key) {
    return userKeybindings[key] ?? defaultKeybindings[key];
}

// Get the key for an action (for display purposes)
function getKeyForAction(action) {
    // Check user bindings first
    for (const [key, act] of Object.entries(userKeybindings)) {
        if (act === action) return key;
    }
    // Fall back to defaults
    for (const [key, act] of Object.entries(defaultKeybindings)) {
        if (act === action && !userKeybindings[key]) return key;
    }
    return null;
}

// Build key string from event (e.g., "Ctrl+k", "Shift+Enter")
function getKeyString(e) {
    let key = e.key;
    // Normalize space
    if (key === ' ') key = 'Space';
    
    let parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.metaKey) parts.push('Meta');
    // Only add Shift for non-character keys or when combined with Ctrl/Alt
    if (e.shiftKey && (parts.length > 0 || key.length > 1)) {
        parts.push('Shift');
    }
    parts.push(key);
    return parts.join('+');
}

// Execute an action by name
function executeAction(action, e) {
    switch (action) {
        // Navigation
        case 'moveDown': moveSelection(1); return true;
        case 'moveUp': moveSelection(-1); return true;
        case 'pendingG': state.pendingKey = 'g'; return true;
        case 'goToEnd': goToBottom(); return true;
        case 'goToTop': goToTop(); return true;
        case 'pageDown': e?.preventDefault(); moveSelection(10); return true;
        case 'pageUp': e?.preventDefault(); moveSelection(-10); return true;
        
        // Playback
        case 'playSelected': playSelected(); return true;
        case 'togglePause': e?.preventDefault(); togglePause(); return true;
        case 'stop': stop(); return true;
        case 'nextTrack': nextTrack(); return true;
        case 'prevTrack': prevTrack(); return true;
        
        // Volume
        case 'volumeUp': adjustVolume(0.05); return true;
        case 'volumeDown': adjustVolume(-0.05); return true;
        case 'toggleMute': toggleMute(); return true;
        
        // Speed
        case 'speedUp': changeSpeed(0.25); return true;
        case 'speedDown': changeSpeed(-0.25); return true;
        case 'speedReset': resetSpeed(); return true;
        
        // Seek
        case 'seekForward': seekRelative(5); return true;
        case 'seekBackward': seekRelative(-5); return true;
        case 'seekForwardLarge': seekRelative(30); return true;
        case 'seekBackwardLarge': seekRelative(-30); return true;
        
        // Modes
        case 'commandMode': e?.preventDefault(); enterCommandMode(); return true;
        case 'filterMode': e?.preventDefault(); enterFilterMode(); return true;
        case 'normalMode':
            if (state.filterText) clearFilter();
            else closeModals();
            return true;
        case 'visualMode': enterVisualMode(); return true;
        
        // View
        case 'toggleView': e?.preventDefault(); toggleViewMode(); return true;
        
        // Repeat/Shuffle
        case 'cycleRepeat': toggleRepeat(); return true;
        case 'toggleShuffle': toggleShuffle(); return true;
        
        // Queue
        case 'addToQueue': addToQueue(); return true;
        case 'toggleQueueView': toggleQueueView(); return true;
        
        // Folder
        case 'openFolder': openFolder(); return true;
        case 'reloadContent': reloadContent(); return true;
        
        // Playlist
        case 'openPlaylistManager': showPlaylistManager(); return true;
        case 'addToPlaylist': showAddToPlaylistPicker(getSelectedTrackPaths()); return true;
        
        // Help
        case 'toggleHelp': toggleHelp(); return true;
        
        // Pending keys
        case 'pendingD': state.pendingKey = 'd'; return true;
        case 'pendingM': state.pendingKey = 'm'; return true;
        case 'pendingQuote': state.pendingKey = "'"; return true;
        
        // A-B Loop
        case 'setLoopA': setLoopA(); return true;
        case 'setLoopB': setLoopB(); return true;
        case 'clearLoop': clearLoop(); return true;
        
        default: return false;
    }
}

// Listen for media control events from backend
async function setupMediaControlListener() {
    if (!listen) return;
    
    await listen('media-control', (event) => {
        console.log('Media control event:', event.payload);
        switch (event.payload) {
            case 'play':
                if (state.isPaused) {
                    togglePause();
                } else if (!state.isPlaying && state.playlist.length > 0) {
                    playTrack(state.selectedIndex);
                }
                break;
            case 'pause':
                if (state.isPlaying && !state.isPaused) {
                    togglePause();
                }
                break;
            case 'toggle':
                togglePause();
                break;
            case 'next':
                nextTrack();
                break;
            case 'prev':
                prevTrack();
                break;
            case 'stop':
                stop();
                break;
        }
    });
}

async function loadDefaultFolder() {
    try {
        const defaultFolder = await invoke('get_default_folder');
        if (defaultFolder) {
            await loadFolder(defaultFolder);
        }
    } catch (err) {
        console.error('Failed to load default folder:', err);
    }
}

// Event Listeners
function setupEventListeners() {
    document.addEventListener('keydown', handleKeyDown);
    
    elements.playBtn.addEventListener('click', togglePause);
    elements.prevBtn.addEventListener('click', prevTrack);
    elements.nextBtn.addEventListener('click', nextTrack);
    elements.stopBtn.addEventListener('click', stop);
    
    elements.commandInput.addEventListener('keydown', handleCommandInput);
    elements.commandInput.addEventListener('blur', exitCommandMode);
    
    elements.filterInput.addEventListener('input', handleFilterInput);
    elements.filterInput.addEventListener('keydown', handleFilterKeydown);
    elements.filterInput.addEventListener('blur', exitFilterMode);
    
    elements.progressBar.addEventListener('click', handleProgressBarClick);
}

function handleProgressBarClick(e) {
    if (!state.isPlaying || !state.duration) return;
    
    const rect = elements.progressBar.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const position = Math.floor(percent * state.duration);
    seekTo(position);
}

// Keyboard Handler
function handleKeyDown(e) {
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
    
    // Visual mode has its own key handling
    if (state.mode === 'visual') {
        handleVisualModeKeyDown(e);
        return;
    }
    
    // Handle multi-key commands
    if (state.pendingKey === 'g') {
        if (e.key === 'g') {
            goToTop();
        }
        state.pendingKey = null;
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
        return;
    }
    
    if (state.pendingKey === "'") {
        // 'a - jump to bookmark a
        if (/[a-z]/i.test(e.key)) {
            jumpToBookmark(e.key.toLowerCase());
        }
        state.pendingKey = null;
        return;
    }
    
    if (state.pendingKey === 'm') {
        // ma - set bookmark a (alternative to :mark a)
        if (/[a-z]/i.test(e.key)) {
            setBookmark(e.key.toLowerCase());
        }
        state.pendingKey = null;
        return;
    }
    
    // Try configurable keybindings first
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
    
    // Handle remaining hardcoded keys that aren't easily configurable
    switch (e.key) {
        case 'n':
            jumpToNextMatch();
            break;
        case 'N':
            jumpToPrevMatch();
            break;
        case 'Backspace':
            if (state.viewMode === 'folder') {
                e.preventDefault();
                navigateFolderUp();
            }
            break;
    }
}

// Command Mode
function enterCommandMode() {
    state.mode = 'command';
    elements.modeIndicator.textContent = 'COMMAND';
    elements.modeIndicator.classList.add('command');
    elements.helpBar.style.display = 'none';
    elements.commandLine.style.display = 'flex';
    elements.commandInput.value = '';
    elements.commandInput.focus();
}

function exitCommandMode() {
    state.mode = 'normal';
    updateModeIndicators();
    elements.modeIndicator.classList.remove('command');
    elements.helpBar.style.display = 'flex';
    elements.commandLine.style.display = 'none';
}

function handleCommandInput(e) {
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

function executeCommand(cmd) {
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
                const percent = parseInt(parts[1].replace('%', ''));
                if (!isNaN(percent) && percent >= 0 && percent <= 100) {
                    jumpToPercent(percent);
                } else {
                    updateStatus('Usage: :jump <0-100> (percentage)');
                }
            } else {
                updateStatus('Usage: :jump <0-100> (percentage)');
            }
            break;
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

// Playlist Management
async function savePlaylist(name) {
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

async function loadSavedPlaylist(name) {
    try {
        updateStatus('Loading playlist...');
        const tracks = await invoke('load_playlist', { name });
        state.playlist = tracks;
        state.selectedIndex = 0;
        state.playingIndex = -1;
        state.viewMode = 'list';
        state.rootFolder = null;
        renderPlaylist();
        updateStatus(`Loaded "${name}" (${tracks.length} tracks)`);
    } catch (err) {
        console.error('Failed to load playlist:', err);
        updateStatus(`Error: ${err}`);
    }
}

async function deletePlaylist(name) {
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

async function showPlaylistManager() {
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

async function refreshPlaylistManager() {
    try {
        const playlists = await invoke('list_playlists');
        state.savedPlaylists = playlists;
        state.playlistManagerIndex = Math.min(state.playlistManagerIndex, Math.max(0, playlists.length - 1));
        renderPlaylistManager();
    } catch (err) {
        console.error('Failed to refresh playlists:', err);
    }
}

function renderPlaylistManager() {
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

function closePlaylistManager() {
    state.playlistManagerOpen = false;
    document.getElementById('playlistManagerModal').classList.remove('visible');
}

function loadSelectedPlaylist() {
    if (state.savedPlaylists.length === 0) return;
    const playlist = state.savedPlaylists[state.playlistManagerIndex];
    closePlaylistManager();
    loadSavedPlaylist(playlist.name);
}

function deleteSelectedPlaylist() {
    if (state.savedPlaylists.length === 0) return;
    const playlist = state.savedPlaylists[state.playlistManagerIndex];
    if (confirm(`Delete playlist "${playlist.name}"?`)) {
        deletePlaylist(playlist.name);
    }
}

function handlePlaylistManagerKeyDown(e) {
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
function getSelectedTrackPaths(indices = null) {
    if (state.viewMode === 'folder') {
        // In folder view, get paths from folder contents
        if (indices) {
            return indices
                .map(i => state.folderContents[i])
                .filter(item => item && item.item_type === 'file')
                .map(item => item.path);
        }
        // Single selection
        const item = state.folderContents[state.folderSelectedIndex];
        if (item && item.item_type === 'file') {
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
async function showAddToPlaylistPicker(trackPaths) {
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

function renderAddToPlaylistPicker() {
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

function closeAddToPlaylistPicker() {
    state.addToPlaylistOpen = false;
    state.addToPlaylistTracks = [];
    document.getElementById('addToPlaylistModal').classList.remove('visible');
}

async function confirmAddToPlaylist() {
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

async function addTracksToPlaylistByName(name) {
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

function handleAddToPlaylistKeyDown(e) {
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

// Navigation
function moveSelection(delta) {
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

function goToTop() {
    if (state.viewMode === 'folder') {
        if (state.folderContents.length === 0) return;
        state.folderSelectedIndex = 0;
        renderFolderView();
        return;
    }
    
    if (state.playlist.length === 0) return;
    selectTrack(0);
}

function goToBottom() {
    if (state.viewMode === 'folder') {
        if (state.folderContents.length === 0) return;
        state.folderSelectedIndex = state.folderContents.length - 1;
        renderFolderView();
        return;
    }
    
    if (state.playlist.length === 0) return;
    selectTrack(state.playlist.length - 1);
}

function selectTrack(index) {
    state.selectedIndex = index;
    renderPlaylist();
    scrollToSelected();
}

function scrollToSelected() {
    const selected = elements.playlist.querySelector('.track-item.selected');
    if (selected) {
        selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function scrollToFolderSelected() {
    const selected = elements.playlist.querySelector('.folder-item.selected');
    if (selected) {
        selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

// Playback Controls
async function playSelected() {
    if (state.viewMode === 'folder') {
        if (state.folderContents.length === 0) return;
        handleFolderItemAction(state.folderSelectedIndex);
        return;
    }
    
    if (state.playlist.length === 0) return;
    await playTrack(state.selectedIndex);
}

async function playTrack(index, seekPosition = 0) {
    try {
        // Clear A-B loop when changing tracks
        if (state.playingIndex !== index) {
            state.loopA = null;
            state.loopB = null;
            stopLoopMonitor();
            updateLoopDisplay();
        }
        
        const result = await invoke('play_track', { index, skipSecs: seekPosition });
        state.playingIndex = index;
        state.isPlaying = true;
        state.isPaused = false;
        state.duration = result.duration;
        state.elapsed = seekPosition;
        updateNowPlaying(result.name);
        renderPlaylist();
        updatePlayButton();
        updateProgressDisplay();
    } catch (err) {
        console.error('Failed to play track:', err);
        updateStatus(`Error: ${err}`);
    }
}

async function togglePause() {
    try {
        const isPaused = await invoke('toggle_pause');
        state.isPaused = isPaused;
        updatePlayButton();
        updateStatus(isPaused ? 'Paused' : 'Playing');
    } catch (err) {
        // No track playing, try to play selected
        if (state.playlist.length > 0) {
            await playSelected();
        }
    }
}

async function stop() {
    try {
        await invoke('stop');
        state.isPlaying = false;
        state.isPaused = false;
        state.playingIndex = -1;
        state.duration = null;
        updateNowPlaying('No track selected');
        updateStatus('Stopped');
        renderPlaylist();
        updatePlayButton();
        resetProgressDisplay();
    } catch (err) {
        console.error('Failed to stop:', err);
    }
}

async function nextTrack() {
    if (state.shuffleMode && state.isPlaying) {
        playNextShuffle();
        return;
    }
    
    try {
        const result = await invoke('next_track');
        state.playingIndex = result.index;
        state.selectedIndex = result.index;
        state.isPlaying = true;
        state.isPaused = false;
        state.duration = result.duration;
        updateNowPlaying(result.name);
        renderPlaylist();
        updatePlayButton();
        scrollToSelected();
    } catch (err) {
        console.error('Failed to play next track:', err);
    }
}

async function prevTrack() {
    if (state.shuffleMode && state.isPlaying) {
        playPrevShuffle();
        return;
    }
    
    try {
        const result = await invoke('prev_track');
        state.playingIndex = result.index;
        state.selectedIndex = result.index;
        state.isPlaying = true;
        state.isPaused = false;
        state.duration = result.duration;
        updateNowPlaying(result.name);
        renderPlaylist();
        updatePlayButton();
        scrollToSelected();
    } catch (err) {
        console.error('Failed to play previous track:', err);
    }
}

// Volume
async function adjustVolume(delta) {
    const newVolume = Math.max(0, Math.min(1, state.volume + delta));
    await setVolume(newVolume);
}

async function setVolume(volume) {
    try {
        const result = await invoke('set_volume', { volume });
        state.volume = result;
        updateVolumeDisplay();
    } catch (err) {
        console.error('Failed to set volume:', err);
    }
}

function toggleMute() {
    if (state.volume > 0) {
        state.previousVolume = state.volume;
        setVolume(0);
    } else {
        setVolume(state.previousVolume);
    }
}

function updateVolumeDisplay() {
    const percent = Math.round(state.volume * 100);
    elements.volumeFill.style.width = `${percent}%`;
    elements.volumeValue.textContent = `${percent}%`;
}

// Speed Control
async function changeSpeed(delta) {
    const newSpeed = Math.max(0.25, Math.min(3.0, state.speed + delta));
    await setSpeed(newSpeed);
}

async function resetSpeed() {
    await setSpeed(1.0);
}

async function setSpeed(speed) {
    try {
        const result = await invoke('set_speed', { speed });
        state.speed = result;
        updateSpeedDisplay();
    } catch (err) {
        console.error('Failed to set speed:', err);
    }
}

function updateSpeedDisplay() {
    const speedText = state.speed === 1.0 ? '' : `${state.speed.toFixed(2)}x`;
    elements.speedIndicator.textContent = speedText;
    elements.speedIndicator.classList.toggle('active', state.speed !== 1.0);
}

// Seeking
async function seekRelative(delta) {
    try {
        await invoke('seek_relative', { delta });
    } catch (err) {
        // Ignore if not playing
    }
}

async function seekTo(position) {
    try {
        await invoke('seek', { position });
    } catch (err) {
        // Ignore if not playing
    }
}

// Jump to percentage of track
function jumpToPercent(percent) {
    if (!state.isPlaying || !state.duration) {
        updateStatus('No track playing');
        return;
    }
    const position = Math.floor((percent / 100) * state.duration);
    seekTo(position);
    updateStatus(`Jumped to ${percent}%`);
}

// Sleep Timer
function setSleepTimer(minutes) {
    clearSleepTimer();
    
    if (minutes <= 0) {
        updateStatus('Sleep timer cleared');
        return;
    }
    
    state.sleepTimerEnd = Date.now() + (minutes * 60 * 1000);
    
    // Update display every second
    state.sleepTimerInterval = setInterval(() => {
        const remaining = state.sleepTimerEnd - Date.now();
        
        if (remaining <= 0) {
            // Timer expired - stop playback
            clearSleepTimer();
            stop();
            updateStatus('Sleep timer: Playback stopped');
        } else {
            updateSleepTimerDisplay(remaining);
        }
    }, 1000);
    
    updateSleepTimerDisplay(minutes * 60 * 1000);
    updateStatus(`Sleep timer set for ${minutes} minute${minutes > 1 ? 's' : ''}`);
}

// Bookmarks
function setBookmark(key) {
    if (!state.isPlaying) {
        updateStatus('No track playing to bookmark');
        return;
    }
    
    const track = state.playlist[state.playingIndex];
    state.bookmarks[key] = {
        track: track.path,
        trackIndex: state.playingIndex,
        position: state.elapsed
    };
    
    updateStatus(`Bookmark '${key}' set at ${formatDuration(state.elapsed)}`);
}

function jumpToBookmark(key) {
    const bookmark = state.bookmarks[key];
    if (!bookmark) {
        updateStatus(`No bookmark '${key}'`);
        return;
    }
    
    // Check if it's the same track
    if (state.isPlaying && state.playlist[state.playingIndex]?.path === bookmark.track) {
        // Just seek to position
        seekTo(bookmark.position);
        updateStatus(`Jumped to bookmark '${key}' at ${formatDuration(bookmark.position)}`);
    } else {
        // Find the track in playlist and play it
        const trackIndex = state.playlist.findIndex(t => t.path === bookmark.track);
        if (trackIndex >= 0) {
            playTrack(trackIndex, bookmark.position);
            updateStatus(`Jumped to bookmark '${key}' at ${formatDuration(bookmark.position)}`);
        } else {
            updateStatus(`Bookmark '${key}' track not in playlist`);
        }
    }
}

function deleteBookmark(key) {
    if (state.bookmarks[key]) {
        delete state.bookmarks[key];
        updateStatus(`Bookmark '${key}' deleted`);
    } else {
        updateStatus(`No bookmark '${key}'`);
    }
}

function showBookmarks() {
    const keys = Object.keys(state.bookmarks).sort();
    if (keys.length === 0) {
        updateStatus('No bookmarks set');
        return;
    }
    
    const list = keys.map(k => {
        const b = state.bookmarks[k];
        const trackName = state.playlist.find(t => t.path === b.track)?.name || 'Unknown';
        return `'${k}': ${trackName} @ ${formatDuration(b.position)}`;
    }).join(', ');
    
    updateStatus(`Bookmarks: ${list}`);
}

// A-B Loop
function setLoopA() {
    if (!state.isPlaying) {
        updateStatus('No track playing');
        return;
    }
    
    state.loopA = state.elapsed;
    state.loopB = null; // Reset B when setting new A
    stopLoopMonitor();
    updateLoopDisplay();
    updateStatus(`Loop A set at ${formatDuration(state.loopA)} - press B to set end point`);
}

function setLoopB() {
    if (!state.isPlaying) {
        updateStatus('No track playing');
        return;
    }
    
    if (state.loopA === null) {
        updateStatus('Set loop point A first (press b)');
        return;
    }
    
    if (state.elapsed <= state.loopA) {
        updateStatus('Loop B must be after loop A');
        return;
    }
    
    state.loopB = state.elapsed;
    startLoopMonitor();
    updateLoopDisplay();
    updateStatus(`Loop: ${formatDuration(state.loopA)} - ${formatDuration(state.loopB)}`);
}

function clearLoop() {
    state.loopA = null;
    state.loopB = null;
    stopLoopMonitor();
    updateLoopDisplay();
    updateStatus('Loop cleared');
}

function startLoopMonitor() {
    stopLoopMonitor();
    
    state.loopInterval = setInterval(() => {
        if (!state.isPlaying || state.loopA === null || state.loopB === null) {
            stopLoopMonitor();
            return;
        }
        
        // Check if we've passed loop B point
        if (state.elapsed >= state.loopB) {
            seekTo(state.loopA);
        }
    }, 100); // Check every 100ms for smooth looping
}

function stopLoopMonitor() {
    if (state.loopInterval) {
        clearInterval(state.loopInterval);
        state.loopInterval = null;
    }
}

function updateLoopDisplay() {
    if (!elements.loopIndicator) return;
    
    if (state.loopA !== null && state.loopB !== null) {
        elements.loopIndicator.textContent = `A-B`;
        elements.loopIndicator.classList.add('active');
    } else if (state.loopA !== null) {
        elements.loopIndicator.textContent = `A...`;
        elements.loopIndicator.classList.add('active');
    } else {
        elements.loopIndicator.textContent = '';
        elements.loopIndicator.classList.remove('active');
    }
}

function adjustSleepTimer(deltaMinutes) {
    if (!state.sleepTimerEnd) {
        // No timer running, start a new one if positive
        if (deltaMinutes > 0) {
            setSleepTimer(deltaMinutes);
        } else {
            updateStatus('No sleep timer to adjust');
        }
        return;
    }
    
    // Add/subtract time from existing timer
    const newEnd = state.sleepTimerEnd + (deltaMinutes * 60 * 1000);
    const remaining = newEnd - Date.now();
    
    if (remaining <= 0) {
        clearSleepTimer();
        updateStatus('Sleep timer cleared');
    } else {
        state.sleepTimerEnd = newEnd;
        const mins = Math.ceil(remaining / 60000);
        updateSleepTimerDisplay(remaining);
        updateStatus(`Sleep timer: ${deltaMinutes > 0 ? '+' : ''}${deltaMinutes} min (${mins} min remaining)`);
    }
}

function clearSleepTimer() {
    if (state.sleepTimerInterval) {
        clearInterval(state.sleepTimerInterval);
        state.sleepTimerInterval = null;
    }
    state.sleepTimerEnd = null;
    updateSleepTimerDisplay(0);
}

function updateSleepTimerDisplay(remainingMs) {
    if (!elements.sleepTimerIndicator) return;
    
    if (remainingMs <= 0) {
        elements.sleepTimerIndicator.textContent = '';
        elements.sleepTimerIndicator.classList.remove('active');
        return;
    }
    
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    
    elements.sleepTimerIndicator.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    elements.sleepTimerIndicator.classList.add('active');
}

// Progress Bar
function startProgressUpdater() {
    if (state.progressInterval) {
        clearInterval(state.progressInterval);
    }
    state.progressInterval = setInterval(updateProgress, 500);
}

async function updateProgress() {
    if (!state.isPlaying) {
        return;
    }
    
    try {
        const status = await invoke('get_status');
        state.elapsed = status.elapsed;
        state.duration = status.duration;
        
        // Sync speed from backend
        if (status.speed !== state.speed) {
            state.speed = status.speed;
            updateSpeedDisplay();
        }
        
        // Check if track finished
        if (status.is_finished) {
            handleTrackEnd();
        }
        
        updateProgressDisplay();
    } catch (err) {
        // Ignore errors
    }
}

function updateProgressDisplay() {
    elements.timeElapsed.textContent = formatDuration(state.elapsed);
    elements.timeTotal.textContent = formatDuration(state.duration);
    
    if (state.duration && state.duration > 0) {
        const percent = (state.elapsed / state.duration) * 100;
        elements.progressFill.style.width = `${Math.min(percent, 100)}%`;
    } else {
        elements.progressFill.style.width = '0%';
    }
}

function resetProgressDisplay() {
    state.elapsed = 0;
    elements.timeElapsed.textContent = '0:00';
    elements.timeTotal.textContent = formatDuration(state.duration);
    elements.progressFill.style.width = '0%';
}

// Repeat & Shuffle
function toggleRepeat() {
    const modes = ['off', 'one', 'all'];
    const currentIndex = modes.indexOf(state.repeatMode);
    state.repeatMode = modes[(currentIndex + 1) % modes.length];
    // Disable shuffle when enabling repeat-one as they conflict
    if (state.repeatMode === 'one' && state.shuffleMode) {
        state.shuffleMode = false;
    }
    updateModeIndicators();
    updateStatus(`Repeat: ${state.repeatMode}`);
}

function toggleShuffle() {
    state.shuffleMode = !state.shuffleMode;
    if (state.shuffleMode) {
        // Reset shuffle history when enabling
        state.shuffleHistory = [];
        state.shuffleIndex = -1;
        // Disable repeat-one as it conflicts with shuffle
        if (state.repeatMode === 'one') {
            state.repeatMode = 'off';
        }
    }
    updateModeIndicators();
    updateStatus(`Shuffle: ${state.shuffleMode ? 'on' : 'off'}`);
}

function updateModeIndicators() {
    let modeText = state.mode.toUpperCase();
    const indicators = [];
    if (state.repeatMode !== 'off') {
        indicators.push(state.repeatMode === 'one' ? 'R1' : 'RA');
    }
    if (state.shuffleMode) {
        indicators.push('S');
    }
    if (state.queue.length > 0) {
        indicators.push(`Q:${state.queue.length}`);
    }
    if (indicators.length > 0) {
        modeText += ` [${indicators.join(' ')}]`;
    }
    elements.modeIndicator.textContent = modeText;
}

function handleTrackEnd() {
    // Cap progress at 100%
    if (state.duration) {
        state.elapsed = state.duration;
    }
    updateProgressDisplay();
    
    // Check queue first (unless repeat-one is active)
    if (state.repeatMode !== 'one' && state.queue.length > 0) {
        const nextIndex = state.queue.shift();
        playTrack(nextIndex);
        updateQueueDisplay();
        return;
    }
    
    if (state.repeatMode === 'one') {
        // Repeat current track
        playTrack(state.playingIndex);
    } else if (state.shuffleMode) {
        // Play random track
        playNextShuffle();
    } else if (state.repeatMode === 'all') {
        // Play next, wrap around
        const nextIndex = (state.playingIndex + 1) % state.playlist.length;
        playTrack(nextIndex);
    } else {
        // No repeat - play next if not at end
        if (state.playingIndex < state.playlist.length - 1) {
            playTrack(state.playingIndex + 1);
        } else {
            // End of playlist
            state.isPlaying = false;
            elements.playIcon.style.display = 'block';
            elements.pauseIcon.style.display = 'none';
        }
    }
}

function playNextShuffle() {
    if (state.playlist.length === 0) return;
    
    // If we're not at the end of history, go forward
    if (state.shuffleIndex < state.shuffleHistory.length - 1) {
        state.shuffleIndex++;
        playTrack(state.shuffleHistory[state.shuffleIndex]);
        return;
    }
    
    // Pick a random track (avoid current if possible)
    let nextIndex;
    if (state.playlist.length === 1) {
        nextIndex = 0;
    } else {
        do {
            nextIndex = Math.floor(Math.random() * state.playlist.length);
        } while (nextIndex === state.playingIndex);
    }
    
    state.shuffleHistory.push(nextIndex);
    state.shuffleIndex = state.shuffleHistory.length - 1;
    playTrack(nextIndex);
}

function playPrevShuffle() {
    if (state.shuffleHistory.length === 0 || state.shuffleIndex <= 0) {
        return;
    }
    state.shuffleIndex--;
    playTrack(state.shuffleHistory[state.shuffleIndex]);
}

// Queue
function addToQueue() {
    if (state.viewMode === 'folder') {
        updateStatus('Queue only works in list view. Use "A" to load folder.');
        return;
    }
    if (state.playlist.length === 0) return;
    
    const track = state.playlist[state.selectedIndex];
    state.queue.push(state.selectedIndex);
    updateQueueDisplay();
    updateStatus(`Added to queue: ${track.name} (${state.queue.length} in queue)`);
}

function addToQueueAndPlay() {
    if (state.viewMode === 'folder') {
        // In folder view, A loads all tracks from current folder
        loadCurrentFolderAsPlaylist();
        return;
    }
    if (state.playlist.length === 0) return;
    
    // If nothing is playing, just play the selected track
    if (!state.isPlaying) {
        playSelected();
        return;
    }
    
    // Add to queue
    addToQueue();
}

async function loadCurrentFolderAsPlaylist() {
    if (state.folderContents.length === 0) return;
    
    // Get all audio files from current folder
    const audioFiles = state.folderContents.filter(item => item.item_type === 'file');
    
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

function clearQueue() {
    state.queue = [];
    updateQueueDisplay();
    updateStatus('Queue cleared');
}

function playFromQueue() {
    if (state.queue.length === 0) return;
    
    const nextIndex = state.queue.shift();
    playTrack(nextIndex);
    updateQueueDisplay();
}

function updateQueueDisplay() {
    // Update mode indicator to show queue count
    updateModeIndicators();
    // Re-render queue view if open
    if (state.queueViewOpen) {
        renderQueueView();
    }
}

// Visual Mode
function enterVisualMode() {
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

function exitVisualMode() {
    state.mode = 'normal';
    state.visualStart = -1;
    updateModeIndicators();
    if (state.viewMode === 'folder') {
        renderFolderView();
    } else {
        renderPlaylist();
    }
}

function getVisualSelection() {
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

function addVisualSelectionToQueue() {
    const selection = getVisualSelection();
    if (selection.length === 0) return;
    
    if (state.viewMode === 'folder') {
        // In folder view, queue only works with files (not folders)
        // and requires tracks to be in the current playlist
        updateStatus('Queue only works in list view. Use "p" to add to playlist.');
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

function handleVisualModeKeyDown(e) {
    const isFolderView = state.viewMode === 'folder';
    const items = isFolderView ? state.folderContents : state.playlist;
    const currentIndex = isFolderView ? state.folderSelectedIndex : state.selectedIndex;
    const render = isFolderView ? renderFolderView : renderPlaylist;
    const scroll = isFolderView ? scrollToFolderSelected : scrollToSelected;
    
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
        return;
    }
    
    switch (e.key) {
        case 'j':
            if (currentIndex < items.length - 1) {
                if (isFolderView) {
                    state.folderSelectedIndex++;
                } else {
                    state.selectedIndex++;
                }
                render();
                scroll();
            }
            break;
        case 'k':
            if (currentIndex > 0) {
                if (isFolderView) {
                    state.folderSelectedIndex--;
                } else {
                    state.selectedIndex--;
                }
                render();
                scroll();
            }
            break;
        case 'g':
            state.pendingKey = 'g';
            break;
        case 'G':
            if (isFolderView) {
                state.folderSelectedIndex = items.length - 1;
            } else {
                state.selectedIndex = items.length - 1;
            }
            render();
            scroll();
            break;
        case 'a':
            addVisualSelectionToQueue();
            break;
        case 'p':
            showAddToPlaylistPicker(getSelectedTrackPaths(getVisualSelection()));
            break;
        case 'v':
        case 'Escape':
            exitVisualMode();
            break;
    }
}

// Queue View
function toggleQueueView() {
    if (state.queueViewOpen) {
        closeQueueView();
    } else {
        openQueueView();
    }
}

function openQueueView() {
    state.queueViewOpen = true;
    state.queueSelectedIndex = 0;
    elements.queueModal.classList.add('visible');
    renderQueueView();
}

function closeQueueView() {
    state.queueViewOpen = false;
    elements.queueModal.classList.remove('visible');
}

function renderQueueView() {
    if (state.queue.length === 0) {
        elements.queueList.innerHTML = '<div class="queue-empty">Queue is empty</div>';
        return;
    }
    
    elements.queueList.innerHTML = state.queue.map((playlistIndex, queueIndex) => {
        const track = state.playlist[playlistIndex];
        const isSelected = queueIndex === state.queueSelectedIndex;
        return `
            <div class="queue-item ${isSelected ? 'selected' : ''}" data-index="${queueIndex}">
                <span class="queue-number">${queueIndex + 1}.</span>
                <span class="queue-name">${track.name}</span>
                <span class="queue-duration">${formatDuration(track.duration)}</span>
            </div>
        `;
    }).join('');
}

function handleQueueViewKeyDown(e) {
    // Handle multi-key commands in queue view
    if (state.pendingKey === 'd') {
        if (e.key === 'd') {
            removeFromQueue(state.queueSelectedIndex);
        }
        state.pendingKey = null;
        return;
    }
    
    if (state.pendingKey === 'g') {
        if (e.key === 'g') {
            state.queueSelectedIndex = 0;
            renderQueueView();
        }
        state.pendingKey = null;
        return;
    }
    
    switch (e.key) {
        case 'j':
            if (state.queueSelectedIndex < state.queue.length - 1) {
                state.queueSelectedIndex++;
                renderQueueView();
            }
            break;
        case 'k':
            if (state.queueSelectedIndex > 0) {
                state.queueSelectedIndex--;
                renderQueueView();
            }
            break;
        case 'J':
            // Move selected item down
            if (state.queueSelectedIndex < state.queue.length - 1) {
                const temp = state.queue[state.queueSelectedIndex];
                state.queue[state.queueSelectedIndex] = state.queue[state.queueSelectedIndex + 1];
                state.queue[state.queueSelectedIndex + 1] = temp;
                state.queueSelectedIndex++;
                renderQueueView();
                updateQueueDisplay();
            }
            break;
        case 'K':
            // Move selected item up
            if (state.queueSelectedIndex > 0) {
                const temp = state.queue[state.queueSelectedIndex];
                state.queue[state.queueSelectedIndex] = state.queue[state.queueSelectedIndex - 1];
                state.queue[state.queueSelectedIndex - 1] = temp;
                state.queueSelectedIndex--;
                renderQueueView();
                updateQueueDisplay();
            }
            break;
        case 'g':
            state.pendingKey = 'g';
            break;
        case 'G':
            state.queueSelectedIndex = Math.max(0, state.queue.length - 1);
            renderQueueView();
            break;
        case 'd':
            state.pendingKey = 'd';
            break;
        case 'c':
            clearQueue();
            break;
        case 'Enter':
            // Play selected queue item immediately
            if (state.queue.length > 0) {
                const trackIndex = state.queue[state.queueSelectedIndex];
                state.queue.splice(state.queueSelectedIndex, 1);
                playTrack(trackIndex);
                if (state.queueSelectedIndex >= state.queue.length) {
                    state.queueSelectedIndex = Math.max(0, state.queue.length - 1);
                }
                updateQueueDisplay();
            }
            break;
        case 'q':
        case 'Escape':
            closeQueueView();
            break;
    }
}

function removeFromQueue(index) {
    if (index >= 0 && index < state.queue.length) {
        const track = state.playlist[state.queue[index]];
        state.queue.splice(index, 1);
        if (state.queueSelectedIndex >= state.queue.length) {
            state.queueSelectedIndex = Math.max(0, state.queue.length - 1);
        }
        updateQueueDisplay();
        updateStatus(`Removed from queue: ${track.name}`);
    }
}

// Track Deletion
function deleteSelectedTracks() {
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
    
    renderPlaylist();
    updateStatus(`Deleted ${indicesToDelete.length} track${indicesToDelete.length > 1 ? 's' : ''}`);
}

function deleteTrackRange(start, end) {
    if (state.playlist.length === 0) return;
    
    // Convert to 0-indexed
    const startIdx = Math.max(0, start - 1);
    const endIdx = Math.min(state.playlist.length - 1, end - 1);
    
    if (startIdx > endIdx) {
        updateStatus('Invalid range');
        return;
    }
    
    const count = endIdx - startIdx + 1;
    
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
    
    renderPlaylist();
    updateStatus(`Deleted ${count} track${count > 1 ? 's' : ''} (lines ${start}-${end})`);
}

// Folder Loading
async function openFolder() {
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

async function loadFolder(path) {
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

async function reloadContent() {
    if (!state.rootFolder) {
        updateStatus('No folder loaded');
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
function toggleViewMode() {
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

async function loadFolderContents(path) {
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
        console.error('Failed to browse folder:', err);
        updateStatus(`Error: ${err}`);
    }
}

function getFolderName(path) {
    return path.split(/[/\\]/).pop() || path;
}

function buildBreadcrumb(currentPath, rootPath) {
    if (!currentPath || !rootPath) return '';
    
    // Normalize paths
    const normCurrent = currentPath.replace(/\\/g, '/');
    const normRoot = rootPath.replace(/\\/g, '/');
    
    // Get relative path from root
    let relativePath = normCurrent;
    if (normCurrent.startsWith(normRoot)) {
        relativePath = normCurrent.slice(normRoot.length);
        if (relativePath.startsWith('/')) relativePath = relativePath.slice(1);
    }
    
    const rootName = getFolderName(rootPath);
    const parts = relativePath ? relativePath.split('/').filter(Boolean) : [];
    
    // Build breadcrumb parts
    const crumbs = [`<span class="breadcrumb-root">${escapeHtml(rootName)}</span>`];
    parts.forEach(part => {
        crumbs.push(`<span class="breadcrumb-separator">/</span><span class="breadcrumb-part">${escapeHtml(part)}</span>`);
    });
    
    return crumbs.join('');
}

function renderFolderView() {
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
    
    const folderName = getFolderName(state.currentFolder);
    const matchedIndices = new Set(state.filteredFolderContents.map(({ index }) => index));
    const visualSelection = state.mode === 'visual' ? new Set(getVisualSelection()) : new Set();
    
    // Build breadcrumb
    const breadcrumb = buildBreadcrumb(state.currentFolder, state.rootFolder);
    elements.playlistCount.textContent = `${folderName} (${state.folderContents.length} items)`;
    
    const breadcrumbHtml = `<div class="folder-breadcrumb">${breadcrumb}</div>`;
    
    const itemsHtml = state.folderContents.map((item, index) => {
        const isSelected = index === state.folderSelectedIndex;
        const isVisualSelected = visualSelection.has(index);
        const isMatch = state.filterText && matchedIndices.has(index);
        const classes = ['track-item'];
        if (isSelected) classes.push('selected');
        if (isVisualSelected) classes.push('visual-selected');
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
    
    elements.playlist.innerHTML = breadcrumbHtml + itemsHtml;
    
    // Add click handlers
    elements.playlist.querySelectorAll('.track-item').forEach(item => {
        item.addEventListener('click', () => {
            const index = parseInt(item.dataset.index);
            state.folderSelectedIndex = index;
            renderFolderView();
        });
        item.addEventListener('dblclick', () => {
            handleFolderItemAction(parseInt(item.dataset.index));
        });
    });
    
    scrollToSelected();
}

function handleFolderItemAction(index) {
    const item = state.folderContents[index];
    if (!item) return;
    
    if (item.is_folder) {
        loadFolderContents(item.path);
    } else {
        playFileFromFolder(item.path);
    }
}

async function playFileFromFolder(filePath) {
    // Find the track in the playlist by path
    const trackIndex = state.playlist.findIndex(t => t.path === filePath);
    if (trackIndex !== -1) {
        await playTrack(trackIndex);
    } else {
        updateStatus('Track not in playlist');
    }
}

function navigateFolderUp() {
    if (state.folderParent && state.currentFolder !== state.rootFolder) {
        loadFolderContents(state.folderParent);
    } else {
        updateStatus('Already at root folder');
    }
}

function updateViewModeIndicator() {
    const indicator = state.viewMode === 'folder' ? 'FOLDER' : 'LIST';
    // Update playlist title to show current view mode
    const title = document.querySelector('.playlist-title');
    if (title) {
        title.textContent = state.viewMode === 'folder' ? 'Browse' : 'Playlist';
    }
}

// UI Updates
function renderPlaylist() {
    if (state.playlist.length === 0) {
        elements.playlist.innerHTML = `
            <div class="empty-playlist">
                <p>No tracks loaded</p>
                <p class="hint">Press <kbd>o</kbd> to open a folder</p>
            </div>
        `;
        elements.playlistCount.textContent = '0 tracks';
        return;
    }
    
    elements.playlistCount.textContent = `${state.playlist.length} tracks`;
    
    const matchedIndices = new Set(state.filteredPlaylist.map(({ index }) => index));
    
    const visualSelection = state.mode === 'visual' ? getVisualSelection() : [];
    const visualSet = new Set(visualSelection);
    
    elements.playlist.innerHTML = state.playlist.map((track, index) => {
        const isSelected = index === state.selectedIndex;
        const isPlaying = index === state.playingIndex;
        const isMatch = state.filterText && matchedIndices.has(index);
        const isVisualSelected = visualSet.has(index);
        const classes = ['track-item'];
        if (isSelected) classes.push('selected');
        if (isPlaying) classes.push('playing');
        if (isMatch) classes.push('match');
        if (isVisualSelected) classes.push('visual-selected');
        
        const duration = formatDuration(track.duration);
        
        return `
            <div class="${classes.join(' ')}" data-index="${index}">
                <span class="track-number">${String(index + 1).padStart(3, ' ')}</span>
                <span class="track-item-name">${escapeHtml(track.name)}</span>
                <span class="track-duration">${duration}</span>
                <svg class="track-playing-indicator" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
            </div>
        `;
    }).join('');
    
    // Add click handlers
    elements.playlist.querySelectorAll('.track-item').forEach(item => {
        item.addEventListener('click', () => {
            const index = parseInt(item.dataset.index);
            selectTrack(index);
        });
        item.addEventListener('dblclick', () => {
            const index = parseInt(item.dataset.index);
            playTrack(index);
        });
    });
}

function updateNowPlaying(name) {
    elements.trackName.textContent = name;
    if (state.isPlaying) {
        elements.trackArt.classList.add('playing');
    } else {
        elements.trackArt.classList.remove('playing');
    }
}

function updateStatus(status) {
    elements.trackStatus.textContent = status;
}

function updatePlayButton() {
    if (state.isPlaying && !state.isPaused) {
        elements.playIcon.style.display = 'none';
        elements.pauseIcon.style.display = 'block';
    } else {
        elements.playIcon.style.display = 'block';
        elements.pauseIcon.style.display = 'none';
    }
}

async function refreshStatus() {
    try {
        const status = await invoke('get_status');
        state.isPlaying = status.is_playing;
        state.isPaused = status.is_paused;
        state.volume = status.volume;
        if (status.current_track) {
            updateNowPlaying(status.current_track);
        }
        updateVolumeDisplay();
        updatePlayButton();
    } catch (err) {
        console.error('Failed to get status:', err);
    }
}

// Help Modal
function toggleHelp() {
    elements.helpModal.classList.toggle('visible');
}

function closeModals() {
    elements.helpModal.classList.remove('visible');
    if (state.mode === 'command') {
        exitCommandMode();
    }
    if (state.mode === 'filter') {
        exitFilterMode();
    }
}

// Filter Mode
function enterFilterMode() {
    state.mode = 'filter';
    elements.modeIndicator.textContent = 'FILTER';
    elements.modeIndicator.classList.add('filter');
    elements.helpBar.style.display = 'none';
    elements.filterLine.style.display = 'flex';
    elements.filterInput.value = state.filterText;
    elements.filterInput.focus();
    elements.filterInput.select();
}

function exitFilterMode() {
    state.mode = 'normal';
    updateModeIndicators();
    elements.modeIndicator.classList.remove('filter');
    elements.helpBar.style.display = 'flex';
    elements.filterLine.style.display = 'none';
}

function handleFilterInput(e) {
    state.filterText = elements.filterInput.value;
    applyFilter();
}

function handleFilterKeydown(e) {
    e.stopPropagation();
    if (e.key === 'Enter') {
        e.preventDefault();
        exitFilterMode();
        const hasMatches = state.viewMode === 'folder' 
            ? state.filteredFolderContents.length > 0 
            : state.filteredPlaylist.length > 0;
        if (hasMatches) {
            jumpToNextMatch();
        }
    } else if (e.key === 'Escape') {
        e.preventDefault();
        clearFilter();
        exitFilterMode();
    }
}

function applyFilter() {
    if (!state.filterText) {
        state.filteredPlaylist = [];
        state.filteredFolderContents = [];
        renderCurrentView();
        return;
    }
    
    const query = state.filterText.toLowerCase();
    
    if (state.viewMode === 'folder') {
        state.filteredFolderContents = state.folderContents
            .map((item, index) => ({ item, index }))
            .filter(({ item }) => item.name.toLowerCase().includes(query));
        renderFolderView();
    } else {
        state.filteredPlaylist = state.playlist
            .map((track, index) => ({ track, index }))
            .filter(({ track }) => track.name.toLowerCase().includes(query));
        renderPlaylist();
    }
    updateFilterStatus();
}

function clearFilter() {
    state.filterText = '';
    state.filteredPlaylist = [];
    state.filteredFolderContents = [];
    elements.filterInput.value = '';
    renderCurrentView();
}

function renderCurrentView() {
    if (state.viewMode === 'folder') {
        renderFolderView();
    } else {
        renderPlaylist();
    }
}

function jumpToNextMatch() {
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

function jumpToPrevMatch() {
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
    const matchCount = state.viewMode === 'folder' 
        ? state.filteredFolderContents.length 
        : state.filteredPlaylist.length;
    
    if (state.filterText && matchCount > 0) {
        updateStatus(`${matchCount} matches`);
    } else if (state.filterText) {
        updateStatus('No matches');
    }
}

// Utilities
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDuration(seconds) {
    if (seconds === null || seconds === undefined) {
        return '--:--';
    }
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

// Start the app
init();
