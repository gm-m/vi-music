// Wait for Tauri to be ready
let invoke, open;

if (window.__TAURI__) {
    invoke = window.__TAURI__.tauri?.invoke || window.__TAURI__.invoke;
    open = window.__TAURI__.dialog?.open;
} else {
    console.warn('Tauri API not available');
    invoke = async () => { throw new Error('Tauri not available'); };
    open = async () => null;
}

// State
const state = {
    playlist: [],
    selectedIndex: 0,
    playingIndex: -1,
    isPlaying: false,
    isPaused: false,
    volume: 1.0,
    previousVolume: 1.0,
    mode: 'normal', // 'normal' | 'command'
    pendingKey: null, // for multi-key commands like 'gg'
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
    helpModal: document.getElementById('helpModal'),
};

// Initialize
async function init() {
    updateVolumeDisplay();
    setupEventListeners();
    await refreshStatus();
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
}

// Keyboard Handler
function handleKeyDown(e) {
    // Ignore if typing in command input
    if (state.mode === 'command') {
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
    
    switch (e.key) {
        // Navigation
        case 'j':
            if (e.shiftKey) {
                nextTrack();
            } else {
                moveSelection(1);
            }
            break;
        case 'k':
            if (e.shiftKey) {
                prevTrack();
            } else {
                moveSelection(-1);
            }
            break;
        case 'g':
            state.pendingKey = 'g';
            break;
        case 'G':
            goToBottom();
            break;
            
        // Playback
        case 'Enter':
            playSelected();
            break;
        case ' ':
            e.preventDefault();
            togglePause();
            break;
        case 's':
            stop();
            break;
            
        // Volume
        case '+':
        case '=':
            adjustVolume(0.05);
            break;
        case '-':
            adjustVolume(-0.05);
            break;
        case 'm':
            toggleMute();
            break;
            
        // General
        case 'o':
            openFolder();
            break;
        case ':':
            enterCommandMode();
            break;
        case '?':
            toggleHelp();
            break;
        case 'Escape':
            closeModals();
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
    elements.modeIndicator.textContent = 'NORMAL';
    elements.modeIndicator.classList.remove('command');
    elements.helpBar.style.display = 'flex';
    elements.commandLine.style.display = 'none';
}

function handleCommandInput(e) {
    if (e.key === 'Enter') {
        executeCommand(elements.commandInput.value);
        exitCommandMode();
    } else if (e.key === 'Escape') {
        exitCommandMode();
    }
}

function executeCommand(cmd) {
    const parts = cmd.trim().toLowerCase().split(/\s+/);
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
    }
}

// Navigation
function moveSelection(delta) {
    if (state.playlist.length === 0) return;
    
    const newIndex = Math.max(0, Math.min(state.playlist.length - 1, state.selectedIndex + delta));
    selectTrack(newIndex);
}

function goToTop() {
    if (state.playlist.length === 0) return;
    selectTrack(0);
}

function goToBottom() {
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

// Playback Controls
async function playSelected() {
    if (state.playlist.length === 0) return;
    await playTrack(state.selectedIndex);
}

async function playTrack(index) {
    try {
        const result = await invoke('play_track', { index });
        state.playingIndex = index;
        state.isPlaying = true;
        state.isPaused = false;
        updateNowPlaying(result.name);
        renderPlaylist();
        updatePlayButton();
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
        updateNowPlaying('No track selected');
        updateStatus('Stopped');
        renderPlaylist();
        updatePlayButton();
    } catch (err) {
        console.error('Failed to stop:', err);
    }
}

async function nextTrack() {
    try {
        const result = await invoke('next_track');
        state.playingIndex = result.index;
        state.selectedIndex = result.index;
        state.isPlaying = true;
        state.isPaused = false;
        updateNowPlaying(result.name);
        renderPlaylist();
        updatePlayButton();
        scrollToSelected();
    } catch (err) {
        console.error('Failed to play next track:', err);
    }
}

async function prevTrack() {
    try {
        const result = await invoke('prev_track');
        state.playingIndex = result.index;
        state.selectedIndex = result.index;
        state.isPlaying = true;
        state.isPaused = false;
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
        renderPlaylist();
        updateStatus(`Loaded ${tracks.length} tracks`);
    } catch (err) {
        console.error('Failed to load folder:', err);
        updateStatus(`Error: ${err}`);
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
    
    elements.playlist.innerHTML = state.playlist.map((track, index) => {
        const isSelected = index === state.selectedIndex;
        const isPlaying = index === state.playingIndex;
        const classes = ['track-item'];
        if (isSelected) classes.push('selected');
        if (isPlaying) classes.push('playing');
        
        return `
            <div class="${classes.join(' ')}" data-index="${index}">
                <span class="track-number">${String(index + 1).padStart(3, ' ')}</span>
                <span class="track-item-name">${escapeHtml(track.name)}</span>
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
}

// Utilities
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Start the app
init();
