// Progress bar interaction: click/drag to seek, hover tooltip with time, clickable cue markers

import { state, elements } from './state.js';
import { formatDuration } from './utils.js';
import { updateProgressDisplay } from './ui.js';
import { seekTo } from './playback.js';

function canSeek() {
    return state.isPlaying && state.duration > 0;
}

function positionAt(clientX) {
    const rect = elements.progressBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * state.duration;
}

function showTooltip(clientX, text) {
    const rect = elements.progressBar.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    elements.progressTooltip.textContent = text;
    elements.progressTooltip.style.left = `${x}px`;
    elements.progressTooltip.classList.add('visible');
}

function hideTooltip() {
    elements.progressTooltip.classList.remove('visible');
}

function updateHover(e) {
    if (!canSeek()) {
        hideTooltip();
        return;
    }
    const cue = e.target.closest?.('.cue-marker');
    if (cue && state.progressDragPosition === null) {
        showTooltip(e.clientX, cue.dataset.label);
    } else {
        showTooltip(e.clientX, formatDuration(positionAt(e.clientX)));
    }
}

export function setupProgressBar() {
    const bar = elements.progressBar;
    
    bar.addEventListener('mousemove', updateHover);
    bar.addEventListener('mouseleave', () => {
        if (state.progressDragPosition === null) hideTooltip();
    });
    
    bar.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || !canSeek()) return;
        e.preventDefault();
        
        const cue = e.target.closest('.cue-marker');
        if (cue) {
            seekTo(parseFloat(cue.dataset.time));
            return;
        }
        state.progressDragPosition = positionAt(e.clientX);
        bar.classList.add('dragging');
        updateProgressDisplay();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (state.progressDragPosition === null) return;
        state.progressDragPosition = positionAt(e.clientX);
        showTooltip(e.clientX, formatDuration(state.progressDragPosition));
        updateProgressDisplay();
    });
    
    document.addEventListener('mouseup', async (e) => {
        if (state.progressDragPosition === null) return;
        const position = state.progressDragPosition;
        bar.classList.remove('dragging');
        if (!bar.contains(e.target)) hideTooltip();
        await seekTo(position);
        state.progressDragPosition = null;
        updateProgressDisplay();
    });
}
