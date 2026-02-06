import { invoke } from './tauri.js';

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
    'J': 'nextTrack',
    'K': 'prevTrack',
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

export async function loadKeybindings() {
    try {
        const json = await invoke('get_keybindings');
        userKeybindings = JSON.parse(json);
    } catch (err) {
        console.error('Failed to load keybindings:', err);
        userKeybindings = {};
    }
}

// Get the action for a key, checking user overrides first
export function getKeyAction(key) {
    return userKeybindings[key] ?? defaultKeybindings[key];
}

// Get the key for an action (for display purposes)
export function getKeyForAction(action) {
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
export function getKeyString(e) {
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
