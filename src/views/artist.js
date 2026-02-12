import { invoke } from '../tauri.js';
import { state, elements } from '../state.js';
import { escapeHtml, formatDuration } from '../utils.js';
import { updateStatus, toggleHelp } from '../ui.js';
import { playTrack, togglePause, stop, nextTrack, prevTrack, adjustVolume, toggleMute, seekRelative } from '../playback.js';
import { scrollToSelected } from '../navigation.js';
import { renderPlaylist } from './playlist.js';
import { updateViewModeIndicator } from './folder.js';
import { getKeyString, getKeyAction } from '../keybindings.js';
import { clearFilter, enterFilterMode, jumpToNextMatch, jumpToPrevMatch } from '../filter.js';
import { enterCommandMode } from '../commands.js';

export async function openArtistView() {
    if (state.playlist.length === 0) {
        updateStatus('No tracks loaded. Load a folder or library first.');
        return;
    }
    
    updateStatus('Scanning metadata...');
    
    try {
        const trackPaths = state.playlist.map(t => t.path);
        const artists = await invoke('get_artists', { tracks: trackPaths });
        
        state.artistList = artists;
        state.artistSelectedIndex = 0;
        state.artistViewMode = 'list';
        state.currentArtist = null;
        state.viewMode = 'artist';
        
        updateViewModeIndicator();
        renderArtistView();
        updateStatus(`${artists.length} artists found`);
    } catch (err) {
        updateStatus(`Failed to scan metadata: ${err}`);
    }
}

export async function openArtistTracks(artistName) {
    try {
        const trackPaths = state.playlist.map(t => t.path);
        const tracks = await invoke('get_artist_tracks', { artist: artistName, tracks: trackPaths });
        
        state.currentArtist = artistName;
        state.artistTracks = tracks;
        state.artistViewMode = 'tracks';
        state.artistSelectedIndex = 0;
        
        updateViewModeIndicator();
        renderArtistView();
    } catch (err) {
        updateStatus(`Failed to load artist tracks: ${err}`);
    }
}

export function renderArtistView() {
    if (state.artistViewMode === 'list') {
        renderArtistList();
    } else {
        renderArtistTrackList();
    }
    scrollToSelected();
}

function renderArtistList() {
    if (state.artistList.length === 0) {
        elements.playlist.innerHTML = `
            <div class="empty-playlist">
                <p>No artists found</p>
                <p class="hint">Load tracks with metadata first</p>
            </div>
        `;
        elements.playlistCount.textContent = '0 artists';
        return;
    }
    
    elements.playlistCount.textContent = `${state.artistList.length} artists`;
    
    const matchedIndices = new Set(state.filteredArtistItems.map(({ index }) => index));
    
    elements.playlist.innerHTML = state.artistList.map((artist, index) => {
        const isSelected = index === state.artistSelectedIndex;
        const isMatch = state.filterText && matchedIndices.has(index);
        const classes = ['track-item'];
        if (isSelected) classes.push('selected');
        if (isMatch) classes.push('match');
        
        return `
            <div class="${classes.join(' ')}" data-index="${index}">
                <span class="track-number">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                </span>
                <span class="track-item-name">${escapeHtml(artist.name)}</span>
                <span class="track-duration">${artist.track_count} track${artist.track_count !== 1 ? 's' : ''}</span>
            </div>
        `;
    }).join('');
    
    // Add click handlers
    elements.playlist.querySelectorAll('.track-item').forEach(item => {
        item.addEventListener('click', () => {
            state.artistSelectedIndex = parseInt(item.dataset.index);
            renderArtistView();
        });
        item.addEventListener('dblclick', () => {
            const idx = parseInt(item.dataset.index);
            const artist = state.artistList[idx];
            if (artist) openArtistTracks(artist.name);
        });
    });
}

function renderArtistTrackList() {
    if (state.artistTracks.length === 0) {
        elements.playlist.innerHTML = `
            <div class="empty-playlist">
                <p>No tracks for this artist</p>
                <p class="hint">Press <kbd>Backspace</kbd> to go back</p>
            </div>
        `;
        elements.playlistCount.textContent = `${state.currentArtist} - 0 tracks`;
        return;
    }
    
    elements.playlistCount.textContent = `${state.currentArtist} - ${state.artistTracks.length} tracks`;
    
    // Header with back button
    const headerHtml = `<div class="folder-breadcrumb"><span class="breadcrumb-item" data-action="back">Artists</span> / <span>${escapeHtml(state.currentArtist)}</span></div>`;
    
    const matchedIndices = new Set(state.filteredArtistItems.map(({ index }) => index));
    
    const tracksHtml = state.artistTracks.map((track, index) => {
        const isSelected = index === state.artistSelectedIndex;
        const isPlaying = state.playlist.findIndex(t => t.path === track.path) === state.playingIndex;
        const isMatch = state.filterText && matchedIndices.has(index);
        const classes = ['track-item'];
        if (isSelected) classes.push('selected');
        if (isPlaying) classes.push('playing');
        if (isMatch) classes.push('match');
        
        let lineNum = '';
        if (state.settings.number || state.settings.relativenumber) {
            if (state.settings.relativenumber) {
                const relativeNum = index === state.artistSelectedIndex ? index + 1 : Math.abs(index - state.artistSelectedIndex);
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
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
            </div>
        `;
    }).join('');
    
    elements.playlist.innerHTML = headerHtml + tracksHtml;
    
    // Back button handler
    const backBtn = elements.playlist.querySelector('[data-action="back"]');
    if (backBtn) {
        backBtn.style.cursor = 'pointer';
        backBtn.addEventListener('click', () => {
            state.artistViewMode = 'list';
            state.artistSelectedIndex = state.artistList.findIndex(a => a.name === state.currentArtist) || 0;
            updateViewModeIndicator();
            renderArtistView();
        });
    }
    
    // Track click handlers
    elements.playlist.querySelectorAll('.track-item').forEach(item => {
        item.addEventListener('click', () => {
            state.artistSelectedIndex = parseInt(item.dataset.index);
            renderArtistView();
        });
        item.addEventListener('dblclick', () => {
            const idx = parseInt(item.dataset.index);
            const track = state.artistTracks[idx];
            if (track) {
                const playlistIdx = state.playlist.findIndex(t => t.path === track.path);
                if (playlistIdx !== -1) playTrack(playlistIdx);
            }
        });
    });
}

export function handleArtistViewKeyDown(e) {
    switch (e.key) {
        case 'j':
            state.artistSelectedIndex = Math.min(
                state.artistSelectedIndex + (parseInt(state.countPrefix) || 1),
                (state.artistViewMode === 'list' ? state.artistList.length : state.artistTracks.length) - 1
            );
            state.countPrefix = '';
            renderArtistView();
            break;
        case 'k':
            state.artistSelectedIndex = Math.max(
                state.artistSelectedIndex - (parseInt(state.countPrefix) || 1),
                0
            );
            state.countPrefix = '';
            renderArtistView();
            break;
        case 'Enter':
            if (state.artistViewMode === 'list') {
                const artist = state.artistList[state.artistSelectedIndex];
                if (artist) openArtistTracks(artist.name);
            } else {
                const track = state.artistTracks[state.artistSelectedIndex];
                if (track) {
                    const playlistIdx = state.playlist.findIndex(t => t.path === track.path);
                    if (playlistIdx !== -1) playTrack(playlistIdx);
                }
            }
            break;
        case 'Backspace':
            e.preventDefault();
            if (state.artistViewMode === 'tracks') {
                state.artistViewMode = 'list';
                state.artistSelectedIndex = state.artistList.findIndex(a => a.name === state.currentArtist) || 0;
                updateViewModeIndicator();
                renderArtistView();
            } else {
                // Exit artist view, go back to list
                state.viewMode = 'list';
                updateViewModeIndicator();
                renderPlaylist();
            }
            break;
        case 'g':
            if (state.pendingKey === 'g') {
                state.artistSelectedIndex = 0;
                state.pendingKey = null;
                state.countPrefix = '';
                renderArtistView();
            } else {
                state.pendingKey = 'g';
            }
            return; // Don't clear pendingKey
        case 'G':
            if (state.countPrefix) {
                state.artistSelectedIndex = Math.min(parseInt(state.countPrefix) - 1,
                    (state.artistViewMode === 'list' ? state.artistList.length : state.artistTracks.length) - 1);
            } else {
                state.artistSelectedIndex = (state.artistViewMode === 'list' ? state.artistList.length : state.artistTracks.length) - 1;
            }
            state.countPrefix = '';
            renderArtistView();
            break;
        case 'Tab':
            e.preventDefault();
            state.viewMode = 'list';
            updateViewModeIndicator();
            renderPlaylist();
            break;
        case 'Escape':
            clearFilter();
            state.viewMode = 'list';
            updateViewModeIndicator();
            renderPlaylist();
            break;
        case 'n':
            jumpToNextMatch();
            break;
        case 'N':
            jumpToPrevMatch();
            break;
        case '/':
            e.preventDefault();
            enterFilterMode();
            break;
        default:
            // Handle count prefix
            if (/^[0-9]$/.test(e.key) && state.pendingKey === null) {
                if (state.countPrefix !== '' || e.key !== '0') {
                    state.countPrefix += e.key;
                    return;
                }
            }
            // Pass through to normal key handling for playback controls etc.
            const keyString = getKeyString(e);
            const action = getKeyAction(keyString) || getKeyAction(e.key);
            if (action) {
                switch (action) {
                    case 'togglePause': e?.preventDefault(); togglePause(); break;
                    case 'stop': stop(); break;
                    case 'nextTrack': nextTrack(); break;
                    case 'prevTrack': prevTrack(); break;
                    case 'volumeUp': adjustVolume(state.settings.volumestep); break;
                    case 'volumeDown': adjustVolume(-state.settings.volumestep); break;
                    case 'toggleMute': toggleMute(); break;
                    case 'seekForward': seekRelative(state.settings.seektime); break;
                    case 'seekBackward': seekRelative(-state.settings.seektime); break;
                    case 'seekForwardLarge': seekRelative(state.settings.seektimelarge); break;
                    case 'seekBackwardLarge': seekRelative(-state.settings.seektimelarge); break;
                    case 'commandMode': e?.preventDefault(); enterCommandMode(); break;
                    case 'filterMode': e?.preventDefault(); enterFilterMode(); break;
                    case 'toggleHelp': toggleHelp(); break;
                }
            }
            break;
    }
    state.pendingKey = null;
}
