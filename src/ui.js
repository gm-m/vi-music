import { state, elements } from './state.js';
import { formatDuration } from './utils.js';

export function updateNowPlaying(name) {
    elements.trackName.textContent = name;
    if (state.isPlaying) {
        elements.trackArt.classList.add('playing');
    } else {
        elements.trackArt.classList.remove('playing');
    }
}

export function updateStatus(status) {
    elements.trackStatus.textContent = status;
}

export function updatePlayButton() {
    elements.playIcon.style.display = state.isPaused || !state.isPlaying ? 'block' : 'none';
    elements.pauseIcon.style.display = state.isPlaying && !state.isPaused ? 'block' : 'none';
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
    elements.timeElapsed.textContent = formatDuration(state.elapsed);
    elements.timeTotal.textContent = formatDuration(state.duration);
    
    if (state.duration && state.duration > 0) {
        const percent = (state.elapsed / state.duration) * 100;
        elements.progressFill.style.width = `${Math.min(percent, 100)}%`;
    } else {
        elements.progressFill.style.width = '0%';
    }
}

export function resetProgressDisplay() {
    state.elapsed = 0;
    elements.timeElapsed.textContent = '0:00';
    elements.timeTotal.textContent = formatDuration(state.duration);
    elements.progressFill.style.width = '0%';
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
}
