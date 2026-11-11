// showcmd (pending count/keys next to the mode indicator) and a which-key style popup
// listing the possible continuations of a pending key

import { state, elements } from './state.js';
import { escapeHtml, formatDuration } from './utils.js';

const POPUP_DELAY_MS = 400;

function bookmarkHints(emptyText) {
    const keys = Object.keys(state.bookmarks).sort();
    if (keys.length === 0) return [['a-z', emptyText]];
    return keys.map(key => {
        const bookmark = state.bookmarks[key];
        const name = state.playlist.find(t => t.path === bookmark.track)?.name
            ?? bookmark.track.split(/[\\/]/).pop();
        return [key, `${name} @ ${formatDuration(bookmark.position)}`];
    });
}

// Continuations of each pending key in the main (list/folder) view
const HINTS = {
    g: () => [['g', 'Go to top'], ['f', 'Reveal in file explorer'], ['v', 'Reselect last visual selection']],
    z: () => [['z', 'Center selection'], ['t', 'Scroll selection to top'], ['b', 'Scroll selection to bottom']],
    d: () => [['d', 'Delete track']],
    m: () => [['a-z', 'Set bookmark at current position'], ...bookmarkHints('No bookmarks yet').filter(([k]) => k !== 'a-z')],
    "'": () => bookmarkHints('No bookmarks set (use m + a-z)'),
};

let popupTimer = null;
let popupKey = null;

function hintsAvailable() {
    return state.mode === 'normal'
        && state.viewMode !== 'artist'
        && !state.queueViewOpen
        && !state.playlistManagerOpen
        && !state.addToPlaylistOpen
        && !state.outputOpen;
}

function hidePopup() {
    clearTimeout(popupTimer);
    popupTimer = null;
    popupKey = null;
    elements.keyHints.classList.remove('visible');
}

function showPopup(key) {
    const rows = HINTS[key]();
    elements.keyHints.innerHTML = rows.map(([k, description]) =>
        `<div class="key-hint"><kbd>${escapeHtml(key)}${escapeHtml(k)}</kbd><span>${escapeHtml(description)}</span></div>`
    ).join('');
    elements.keyHints.classList.add('visible');
}

// Call after every keydown
export function updateKeyHints() {
    elements.showcmd.textContent = `${state.countPrefix}${state.pendingKey ?? ''}`;
    
    const key = state.pendingKey;
    if (!key || !HINTS[key] || !hintsAvailable()) {
        hidePopup();
        return;
    }
    if (popupKey === key) return;
    hidePopup();
    popupKey = key;
    popupTimer = setTimeout(() => showPopup(key), POPUP_DELAY_MS);
}
