// VI Music - Entry Point
// All functionality is split into ES modules under src/

import { invoke, listen } from './tauri.js';
import { state, elements } from './state.js';
import { updateVolumeDisplay, setupHelpTabs } from './ui.js';
import { loadKeybindings } from './keybindings.js';
import { loadSettings } from './settings.js';
import { refreshStatus, startProgressUpdater, setupMediaControlListener, togglePause, prevTrack, nextTrack, stop, seekTo, setVolume } from './playback.js';
import { handleKeyDown } from './keyboard.js';
import { handleCommandInput, exitCommandMode } from './commands.js';
import { handleFilterInput, handleFilterKeydown, exitFilterMode } from './filter.js';
import { loadFolder } from './views/folder.js';

// Initialize
async function init() {
    await loadKeybindings();
    await loadSettings();
    updateVolumeDisplay();
    setupEventListeners();
    setupMediaControlListener(listen);
    setupHelpTabs();
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
    
    elements.volumeBar.addEventListener('click', handleVolumeBarClick);
    elements.volumeBar.addEventListener('mousedown', handleVolumeBarDragStart);
}

function handleProgressBarClick(e) {
    if (!state.isPlaying || !state.duration) return;
    
    const rect = elements.progressBar.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const position = Math.floor(percent * state.duration);
    seekTo(position);
}

function handleVolumeBarClick(e) {
    const rect = elements.volumeBar.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setVolume(percent);
}

let isDraggingVolume = false;

function handleVolumeBarDragStart(e) {
    isDraggingVolume = true;
    handleVolumeBarClick(e);
    e.preventDefault();
}

document.addEventListener('mousemove', (e) => {
    if (!isDraggingVolume) return;
    handleVolumeBarClick(e);
});

document.addEventListener('mouseup', () => {
    isDraggingVolume = false;
});

// Start the app
init();
