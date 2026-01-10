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
    filteredPlaylist: [],
    filterText: '',
    selectedIndex: 0,
    playingIndex: -1,
    isPlaying: false,
    isPaused: false,
    volume: 1.0,
    previousVolume: 1.0,
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
};

// Initialize
async function init() {
    updateVolumeDisplay();
    setupEventListeners();
    await refreshStatus();
    startProgressUpdater();
    await loadDefaultFolder();
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
            // dd in normal mode does nothing
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
            
        // Seeking
        case 'l':
            seekRelative(5);
            break;
        case 'h':
            seekRelative(-5);
            break;
        case 'L':
            seekRelative(30);
            break;
        case 'H':
            seekRelative(-30);
            break;
        
        // Repeat & Shuffle
        case 'r':
            toggleRepeat();
            break;
        case 'S':
            toggleShuffle();
            break;
        
        // Queue
        case 'a':
            addToQueue();
            break;
        case 'A':
            addToQueueAndPlay();
            break;
        case 'q':
            toggleQueueView();
            break;
        case 'd':
            state.pendingKey = 'd';
            break;
        case 'v':
            enterVisualMode();
            break;
            
        // General
        case 'o':
            openFolder();
            break;
        case ':':
            e.preventDefault();
            enterCommandMode();
            break;
        case '/':
            e.preventDefault();
            enterFilterMode();
            break;
        case 'n':
            jumpToNextMatch();
            break;
        case 'N':
            jumpToPrevMatch();
            break;
        case '?':
            toggleHelp();
            break;
        case 'Escape':
            if (state.filterText) {
                clearFilter();
            } else {
                closeModals();
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
        case 'setdefault':
        case 'sd':
            setDefaultFolder();
            break;
        case 'cleardefault':
        case 'cd':
            clearDefaultFolder();
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
        state.duration = result.duration;
        state.elapsed = 0;
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
    if (state.playlist.length === 0) return;
    
    const track = state.playlist[state.selectedIndex];
    state.queue.push(state.selectedIndex);
    updateQueueDisplay();
    updateStatus(`Added to queue: ${track.name} (${state.queue.length} in queue)`);
}

function addToQueueAndPlay() {
    if (state.playlist.length === 0) return;
    
    // If nothing is playing, just play the selected track
    if (!state.isPlaying) {
        playSelected();
        return;
    }
    
    // Add to queue
    addToQueue();
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
    if (state.playlist.length === 0) return;
    
    state.mode = 'visual';
    state.visualStart = state.selectedIndex;
    updateModeIndicators();
    renderPlaylist();
}

function exitVisualMode() {
    state.mode = 'normal';
    state.visualStart = -1;
    updateModeIndicators();
    renderPlaylist();
}

function getVisualSelection() {
    if (state.visualStart === -1) return [];
    const start = Math.min(state.visualStart, state.selectedIndex);
    const end = Math.max(state.visualStart, state.selectedIndex);
    const indices = [];
    for (let i = start; i <= end; i++) {
        indices.push(i);
    }
    return indices;
}

function addVisualSelectionToQueue() {
    const selection = getVisualSelection();
    if (selection.length === 0) return;
    
    selection.forEach(index => {
        state.queue.push(index);
    });
    
    updateQueueDisplay();
    updateStatus(`Added ${selection.length} tracks to queue`);
    exitVisualMode();
}

function handleVisualModeKeyDown(e) {
    // Handle multi-key commands in visual mode
    if (state.pendingKey === 'g') {
        if (e.key === 'g') {
            state.selectedIndex = 0;
            renderPlaylist();
            scrollToSelected();
        }
        state.pendingKey = null;
        return;
    }
    
    switch (e.key) {
        case 'j':
            if (state.selectedIndex < state.playlist.length - 1) {
                state.selectedIndex++;
                renderPlaylist();
                scrollToSelected();
            }
            break;
        case 'k':
            if (state.selectedIndex > 0) {
                state.selectedIndex--;
                renderPlaylist();
                scrollToSelected();
            }
            break;
        case 'g':
            state.pendingKey = 'g';
            break;
        case 'G':
            state.selectedIndex = state.playlist.length - 1;
            renderPlaylist();
            scrollToSelected();
            break;
        case 'a':
            addVisualSelectionToQueue();
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
        if (state.filteredPlaylist.length > 0) {
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
        renderPlaylist();
        return;
    }
    
    const query = state.filterText.toLowerCase();
    state.filteredPlaylist = state.playlist
        .map((track, index) => ({ track, index }))
        .filter(({ track }) => track.name.toLowerCase().includes(query));
    
    renderPlaylist();
    updateFilterStatus();
}

function clearFilter() {
    state.filterText = '';
    state.filteredPlaylist = [];
    elements.filterInput.value = '';
    renderPlaylist();
}

function jumpToNextMatch() {
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
    if (state.filterText && state.filteredPlaylist.length > 0) {
        updateStatus(`${state.filteredPlaylist.length} matches`);
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
