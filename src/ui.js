import { state, elements } from './state.js';
import { escapeHtml, formatDuration, formatPreciseTime } from './utils.js';
import { trackLabel } from './tags.js';

export function updateNowPlaying(name) {
    elements.trackName.textContent = name;
    if (state.isPlaying) {
        elements.trackArt.classList.add('playing');
    } else {
        elements.trackArt.classList.remove('playing');
    }
    updatePlaybackState();
}

// Re-label the playing track (e.g. once its tags have loaded or `:set tags` changed)
export function refreshNowPlaying() {
    const track = state.isPlaying ? state.playlist[state.playingIndex] : null;
    if (track) elements.trackName.textContent = trackLabel(track);
}

// Line under the track name: playback state, not transient messages
function updatePlaybackState() {
    elements.trackStatus.textContent = !state.isPlaying ? 'Stopped' : state.isPaused ? 'Paused' : 'Playing';
}

// Messages (vim-style): shown in the footer for a few seconds, kept in a history (:messages)
const MESSAGE_HISTORY_LIMIT = 200;
const MESSAGE_TIMEOUT_MS = 4000;
const ERROR_TIMEOUT_MS = 8000;
const ERROR_PATTERN = /^(error\b|failed\b)|\bfailed\b|^invalid\b|^unknown\b/i;
let messageTimer = null;

// Show a message. Multi-line text opens in the output popup.
// options.level: 'info' | 'error' (default: detected from the text)
// options.history: false to skip the :messages history (e.g. live filter counts)
export function updateStatus(text, { level = null, history = true } = {}) {
    const message = String(text);
    const resolvedLevel = level ?? (ERROR_PATTERN.test(message) ? 'error' : 'info');
    if (history && state.messages.at(-1)?.text !== message) {
        state.messages.push({ text: message, level: resolvedLevel, time: new Date() });
        if (state.messages.length > MESSAGE_HISTORY_LIMIT) state.messages.shift();
    }
    
    const [first, ...rest] = message.split('\n');
    if (rest.length > 0) {
        showOutput(first.replace(/:$/, ''), rest);
    }
    showMessageLine(rest.length > 0 ? first : message, resolvedLevel);
}

function showMessageLine(text, level) {
    elements.messageLine.textContent = text;
    elements.messageLine.classList.toggle('error', level === 'error');
    elements.footer.classList.add('has-message');
    clearTimeout(messageTimer);
    messageTimer = setTimeout(clearMessage, level === 'error' ? ERROR_TIMEOUT_MS : MESSAGE_TIMEOUT_MS);
}

export function clearMessage() {
    clearTimeout(messageTimer);
    messageTimer = null;
    elements.footer.classList.remove('has-message');
}

export function showMessages() {
    if (state.messages.length === 0) {
        updateStatus('No messages', { history: false });
        return;
    }
    const time = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const lines = state.messages.map(m => ({ text: `${time(m.time)}  ${m.text}`, error: m.level === 'error' }));
    showOutput('Messages', lines, { scrollToEnd: true });
}

export function clearMessages() {
    state.messages = [];
    clearMessage();
}

// Scrollable popup for long command output. `lines` are strings or { text, error }.
export function showOutput(title, lines, { scrollToEnd = false } = {}) {
    elements.outputTitle.textContent = title;
    elements.outputBody.innerHTML = lines.map(line => {
        const { text, error } = typeof line === 'string' ? { text: line, error: false } : line;
        return `<div class="output-line${error ? ' error' : ''}">${escapeHtml(text)}</div>`;
    }).join('');
    state.outputOpen = true;
    elements.outputModal.classList.add('visible');
    elements.outputBody.scrollTop = scrollToEnd ? elements.outputBody.scrollHeight : 0;
}

export function closeOutput() {
    state.outputOpen = false;
    elements.outputModal.classList.remove('visible');
}

export function handleOutputKeyDown(e) {
    const body = elements.outputBody;
    const line = 24;
    switch (e.key) {
        case 'j': case 'ArrowDown': body.scrollTop += line; break;
        case 'k': case 'ArrowUp': body.scrollTop -= line; break;
        case 'd': if (e.ctrlKey) { e.preventDefault(); body.scrollTop += body.clientHeight / 2; } break;
        case 'u': if (e.ctrlKey) { e.preventDefault(); body.scrollTop -= body.clientHeight / 2; } break;
        case 'g': body.scrollTop = 0; break;
        case 'G': body.scrollTop = body.scrollHeight; break;
        case 'q': case 'Escape': case 'Enter': e.preventDefault(); closeOutput(); break;
    }
}

export function updatePlayButton() {
    elements.playIcon.style.display = state.isPaused || !state.isPlaying ? 'block' : 'none';
    elements.pauseIcon.style.display = state.isPlaying && !state.isPaused ? 'block' : 'none';
    updatePlaybackState();
}

export function updateVolumeDisplay() {
    const percent = Math.round(state.volume * 100);
    elements.volumeFill.style.width = `${percent}%`;
    elements.volumeValue.textContent = `${percent}%`;
}

export function updateSpeedDisplay() {
    const speedText = state.speed === 1.0 ? '' : `${state.speed.toFixed(2)}x`;
    elements.speedIndicator.textContent = speedText;
    elements.speedIndicator.classList.toggle('active', state.speed !== 1.0);
}

export function updateModeIndicators() {
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

export function updateProgressDisplay() {
    // While dragging the progress bar, preview the drag position instead
    const position = state.progressDragPosition ?? state.elapsed;
    elements.timeElapsed.textContent = formatDuration(position);
    if (state.settings.remainingtime && state.duration && state.duration > 0) {
        const remaining = Math.max(0, state.duration - position);
        elements.timeTotal.textContent = `-${formatDuration(remaining)}`;
    } else {
        elements.timeTotal.textContent = formatDuration(state.duration);
    }
    
    if (state.duration && state.duration > 0) {
        const percent = (position / state.duration) * 100;
        elements.progressFill.style.width = `${Math.min(percent, 100)}%`;
    } else {
        elements.progressFill.style.width = '0%';
    }
    updateCueMarkers();
    updateLoopRange();
}

// Highlight the A-B loop on the progress bar (a thin marker while only A is set)
function updateLoopRange() {
    const range = elements.loopRange;
    const duration = state.duration > 0 ? state.duration : null;
    if (!range) return;
    if (!duration || state.loopA === null) {
        range.classList.remove('active');
        return;
    }
    const start = Math.min((state.loopA / duration) * 100, 100);
    range.classList.add('active');
    range.classList.toggle('pending', state.loopB === null);
    range.style.left = `${start}%`;
    range.style.width = state.loopB === null ? '' : `${Math.min((state.loopB / duration) * 100, 100) - start}%`;
}

function updateCueMarkers() {
    if (!elements.cueMarkers) return;
    const path = state.isPlaying ? state.playlist[state.playingIndex]?.path : null;
    const cues = (path && state.cues[path]) || [];
    const duration = state.duration > 0 ? state.duration : null;
    const key = duration ? `${path}|${duration}|${JSON.stringify(cues)}` : '';
    if (key === state.cueMarkersKey) return;
    state.cueMarkersKey = key;
    
    elements.cueMarkers.replaceChildren(...(duration ? cues : []).map((cue, i) => {
        const marker = document.createElement('div');
        marker.className = 'cue-marker';
        marker.style.left = `${Math.min((cue.time / duration) * 100, 100)}%`;
        marker.dataset.time = cue.time;
        marker.dataset.label = `Cue ${i + 1} @ ${formatPreciseTime(cue.time)}${cue.label ? ` - ${cue.label}` : ''}`;
        return marker;
    }));
}

export function resetProgressDisplay() {
    state.elapsed = 0;
    elements.timeElapsed.textContent = '0:00';
    if (state.settings.remainingtime && state.duration && state.duration > 0) {
        elements.timeTotal.textContent = `-${formatDuration(state.duration)}`;
    } else {
        elements.timeTotal.textContent = formatDuration(state.duration);
    }
    elements.progressFill.style.width = '0%';
    updateCueMarkers();
    updateLoopRange();
}

export function showLoading(text = 'Loading...') {
    elements.loadingText.textContent = text;
    elements.loadingOverlay.style.display = 'flex';
}

export function hideLoading() {
    elements.loadingOverlay.style.display = 'none';
}

export function toggleHelp() {
    elements.helpModal.classList.toggle('visible');
}

export function setupHelpTabs() {
    const tabs = document.querySelectorAll('.help-tab');
    const contents = document.querySelectorAll('.help-tab-content');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;
            
            // Update active tab
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Update active content
            contents.forEach(c => c.classList.remove('active'));
            document.getElementById(`help-${targetTab}`).classList.add('active');
        });
    });
}

export function closeModals() {
    if (state.outputOpen) {
        closeOutput();
        return;
    }
    if (elements.helpModal.classList.contains('visible')) {
        elements.helpModal.classList.remove('visible');
        return;
    }
    state.mode = 'normal';
    updateModeIndicators();
}

export function updateSleepTimerDisplay(remainingMs) {
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

export function updateLoopDisplay() {
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
    updateLoopRange();
}
