import { state, elements } from '../state.js';
import { escapeHtml, formatDuration } from '../utils.js';

export function renderPlaylist() {
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
    
    const visualSelection = state.mode === 'visual' && state.viewMode === 'list' ? getVisualSelectionIndices() : new Set();
    
    elements.playlist.innerHTML = state.playlist.map((track, index) => {
        const isPlaying = index === state.playingIndex;
        const isSelected = index === state.selectedIndex;
        const isInVisual = visualSelection.has(index);
        const isMatch = state.filterText && state.filteredPlaylist.some(fp => fp.index === index);
        const classes = ['track-item'];
        if (isPlaying) classes.push('playing');
        if (isSelected) classes.push('selected');
        if (isInVisual) classes.push('visual-selected');
        if (isMatch) classes.push('match');
        
        let lineNum = '';
        if (state.settings.number || state.settings.relativenumber) {
            if (state.settings.relativenumber) {
                const relativeNum = index === state.selectedIndex ? index + 1 : Math.abs(index - state.selectedIndex);
                lineNum = String(relativeNum).padStart(3, ' ');
            } else {
                lineNum = String(index + 1).padStart(3, ' ');
            }
        }
        
        return `
            <div class="${classes.join(' ')}" data-index="${index}">
                <span class="track-number">${lineNum}</span>
                <span class="track-item-name">${escapeHtml(track.name)}</span>
                <span class="track-duration">${formatDuration(track.duration)}</span>
                <svg class="track-playing-indicator" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                </svg>
            </div>
        `;
    }).join('');
    
    // Add click handlers
    elements.playlist.querySelectorAll('.track-item').forEach(item => {
        item.addEventListener('click', () => {
            const index = parseInt(item.dataset.index);
            state.selectedIndex = index;
            renderPlaylist();
        });
        item.addEventListener('dblclick', () => {
            const index = parseInt(item.dataset.index);
            import('../playback.js').then(m => m.playTrack(index));
        });
    });
}

function getVisualSelectionIndices() {
    if (state.visualStart === -1) return new Set();
    const start = Math.min(state.visualStart, state.selectedIndex);
    const end = Math.max(state.visualStart, state.selectedIndex);
    const indices = new Set();
    for (let i = start; i <= end; i++) {
        indices.add(i);
    }
    return indices;
}
