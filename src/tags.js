// Lazily loaded tag metadata (title/artist) for tracks, shown when `:set tags` is on.
// Only tracks that are actually displayed are requested, in small batches.

import { invoke } from './tauri.js';
import { state } from './state.js';

const EMPTY = Object.freeze({ title: null, artist: null });
const BATCH_DELAY_MS = 30;

const tags = new Map(); // path -> { title, artist }
const pending = new Set();
const listeners = new Set();
let flushTimer = null;

// Called (without arguments) whenever a batch of tags has been loaded
export function onTagsLoaded(listener) {
    listeners.add(listener);
}

export function requestTrackTags(paths) {
    if (!state.settings.tags) return;
    for (const path of paths) {
        if (!tags.has(path)) pending.add(path);
    }
    if (pending.size > 0 && !flushTimer) {
        flushTimer = setTimeout(flush, BATCH_DELAY_MS);
    }
}

async function flush() {
    flushTimer = null;
    const batch = [...pending];
    pending.clear();
    // Mark as requested so they aren't queued again while loading
    for (const path of batch) tags.set(path, EMPTY);
    
    try {
        const metas = await invoke('scan_metadata', { tracks: batch });
        for (const meta of metas) {
            tags.set(meta.path, { title: meta.title || null, artist: meta.artist || null });
        }
    } catch (err) {
        console.error('Failed to load tags:', err);
    }
    listeners.forEach(listener => listener());
}

function getTags(track) {
    return (state.settings.tags && tags.get(track.path)) || EMPTY;
}

// Title to display for a track: tag title, or the file name
export function trackTitle(track) {
    return getTags(track).title || track.name;
}

export function trackArtist(track) {
    return getTags(track).artist;
}

// "Title — Artist" (or the file name when tags are off/unavailable)
export function trackLabel(track) {
    const { title, artist } = getTags(track);
    if (!title) return track.name;
    return artist ? `${title} — ${artist}` : title;
}

// Text matched by the filter: file name plus any loaded tags
export function trackSearchText(track) {
    const { title, artist } = getTags(track);
    return [track.name, title, artist].filter(Boolean).join(' ');
}
