import { state, elements } from '../state.js';
import { escapeHtml, formatDuration } from '../utils.js';
import { scrollRowIntoView } from '../scroll.js';
import { requestTrackTags, trackTitle, trackArtist, onTagsLoaded } from '../tags.js';
import { refreshNowPlaying } from '../ui.js';

// The playlist is virtualized: only the rows in (and around) the viewport are in the DOM,
// so moving the selection or scrolling stays cheap with very large playlists.
const OVERSCAN_ROWS = 10;
const FALLBACK_ROW_HEIGHT = 41;

let rowHeight = 0;
let listenersAttached = false;
let scrollFrame = 0;
let matchSource = null;
let matchSet = new Set();

function isListView() {
    return state.viewMode === 'list';
}

function getVirtualList() {
    return elements.playlist.querySelector(':scope > .virtual-list');
}

// Indices of rows matching the current filter (rebuilt only when the filter result changes)
function getMatchSet() {
    if (!state.filterText) return null;
    if (matchSource !== state.filteredPlaylist) {
        matchSource = state.filteredPlaylist;
        matchSet = new Set(matchSource.map(fp => fp.index));
    }
    return matchSet;
}

function getVisualRange() {
    if (state.mode !== 'visual' || state.visualStart === -1) return null;
    return [Math.min(state.visualStart, state.selectedIndex), Math.max(state.visualStart, state.selectedIndex)];
}

function lineNumber(index) {
    if (state.settings.relativenumber) {
        const relative = index === state.selectedIndex ? index + 1 : Math.abs(index - state.selectedIndex);
        return String(relative).padStart(3, ' ');
    }
    return state.settings.number ? String(index + 1).padStart(3, ' ') : '';
}

function renderRow(track, index, matches, visualRange) {
    const classes = ['track-item'];
    if (index === state.playingIndex) classes.push('playing');
    if (index === state.selectedIndex) classes.push('selected');
    if (visualRange && index >= visualRange[0] && index <= visualRange[1]) classes.push('visual-selected');
    if (matches?.has(index)) classes.push('match');
    
    const artist = state.settings.tags ? trackArtist(track) : null;
    return `
        <div class="${classes.join(' ')}" data-index="${index}">
            <span class="track-number">${lineNumber(index)}</span>
            <span class="track-item-name">${escapeHtml(trackTitle(track))}</span>
            ${state.settings.tags ? `<span class="track-artist">${escapeHtml(artist ?? '')}</span>` : ''}
            <span class="track-duration">${formatDuration(track.duration)}</span>
            <svg class="track-playing-indicator" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
            </svg>
        </div>
    `;
}

function measureRowHeight(rowsContainer) {
    if (rowHeight > 0) return rowHeight;
    rowsContainer.innerHTML = renderRow(state.playlist[0], 0, null, null);
    rowHeight = rowsContainer.firstElementChild?.getBoundingClientRect().height || 0;
    return rowHeight || FALLBACK_ROW_HEIGHT;
}

// Render only the rows intersecting the viewport
function renderWindow() {
    const list = getVirtualList();
    if (!list || !isListView()) return;
    const rows = list.firstElementChild;
    const total = state.playlist.length;
    const height = measureRowHeight(rows);
    const container = elements.playlist;
    // Set the height first, so scrollTop is already clamped if the playlist got shorter
    list.style.height = `${total * height}px`;
    
    const viewTop = Math.max(0, container.scrollTop - list.offsetTop);
    const start = Math.max(0, Math.floor(viewTop / height) - OVERSCAN_ROWS);
    const end = Math.min(total, Math.ceil((viewTop + container.clientHeight) / height) + OVERSCAN_ROWS);
    
    const matches = getMatchSet();
    const visualRange = getVisualRange();
    const visible = state.playlist.slice(start, end);
    rows.style.transform = `translateY(${start * height}px)`;
    rows.innerHTML = visible.map((track, i) => renderRow(track, start + i, matches, visualRange)).join('');
    
    if (state.settings.tags) requestTrackTags(visible.map(t => t.path));
}

function scheduleRender() {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        renderWindow();
    });
}

function attachListeners() {
    if (listenersAttached) return;
    listenersAttached = true;
    
    elements.playlist.addEventListener('scroll', () => {
        if (isListView()) scheduleRender();
    });
    window.addEventListener('resize', () => {
        if (isListView()) scheduleRender();
    });
    
    // Event delegation: one listener for all rows (other views attach their own)
    const rowIndex = (e) => {
        if (!isListView()) return null;
        const item = e.target.closest('.virtual-list .track-item[data-index]');
        return item ? parseInt(item.dataset.index) : null;
    };
    elements.playlist.addEventListener('click', (e) => {
        const index = rowIndex(e);
        if (index === null) return;
        state.selectedIndex = index;
        renderWindow();
        // The re-render replaces the clicked row, so a real 'dblclick' would
        // target a different element; use the click count instead.
        if (e.detail === 2) import('../playback.js').then(m => m.playTrack(index));
    });
    
    onTagsLoaded(() => {
        if (isListView()) renderWindow();
        refreshNowPlaying();
    });
}

export function renderPlaylist() {
    attachListeners();
    
    if (state.playlist.length === 0) {
        elements.playlist.innerHTML = `
            <div class="empty-playlist">
                <p>No tracks loaded</p>
                <p class="hint">Press <kbd>o</kbd> to open a folder or <kbd>:help</kbd> for commands</p>
            </div>
        `;
        elements.playlistCount.textContent = '0 tracks';
        return;
    }
    
    elements.playlistCount.textContent = `${state.playlist.length} tracks`;
    if (!getVirtualList()) {
        elements.playlist.innerHTML = '<div class="virtual-list"><div class="virtual-rows"></div></div>';
    }
    renderWindow();
}

// Scroll the playlist so that row `index` is visible (see scrollRowIntoView for `block`)
export function scrollPlaylistToIndex(index, block = 'nearest') {
    const list = getVirtualList();
    if (!list) return;
    const height = rowHeight || FALLBACK_ROW_HEIGHT;
    scrollRowIntoView(elements.playlist, list.offsetTop + index * height, height, block);
    renderWindow();
}
