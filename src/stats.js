import { state } from './state.js';
import { invoke } from './tauri.js';
import { showOutput, updateStatus } from './ui.js';

let database;
let session = null;
let countedPlaybackId = null;
let resetting = false;
let reportVersion = 0;

function openDatabase() {
    if (!database) {
        database = new Promise((resolve, reject) => {
            const request = indexedDB.open('vi-music-listening', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('tracks', { keyPath: 'path' });
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        }).catch(error => {
            database = null;
            throw error;
        });
    }
    return database;
}

async function recordListen(path, lastPlayed) {
    const db = await openDatabase();
    // A single transaction also serializes increments from other open windows.
    await new Promise((resolve, reject) => {
        const tx = db.transaction('tracks', 'readwrite');
        const tracks = tx.objectStore('tracks');
        const read = tracks.get(path);
        read.onsuccess = () => tracks.put({
            path,
            plays: (read.result?.plays ?? 0) + 1,
            lastPlayed: Math.max(read.result?.lastPlayed ?? 0, lastPlayed),
        });
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
    });
}

// Reuse the player's existing status and transport events. Only active wall time
// counts, so changing the playhead or playback speed cannot add listening time.
export function observeListening(id, path, duration, advancing) {
    if (resetting) return;
    if (!state.settings.analytics) {
        session = null;
        return;
    }
    if (!session && (!path || countedPlaybackId === id)) return;

    const now = performance.now();
    if (session && session.since !== null) {
        session.listened += now - session.since;
        if (session.listened >= session.threshold) {
            countedPlaybackId = session.id;
            recordListen(session.path, Date.now()).catch(error => updateStatus(`Failed to save listen: ${error}`));
            session = null;
        }
    }
    if (!path || id === countedPlaybackId) {
        session = null;
        return;
    }
    if (session?.id !== id) {
        const threshold = duration > 0 ? Math.min(30_000, duration * 500) : 30_000;
        session = { id, path, threshold, listened: 0, since: null };
    }
    session.since = advancing ? now : null;
}

function fileName(path) {
    return path.split(/[\\/]/).pop();
}

export async function resetListeningStats() {
    if (resetting) return;
    resetting = true;
    ++reportVersion;
    try {
        const db = await openDatabase();
        await new Promise((resolve, reject) => {
            const tx = db.transaction('tracks', 'readwrite');
            tx.objectStore('tracks').clear();
            tx.oncomplete = resolve;
            tx.onabort = () => reject(tx.error);
        });
        session = null;
        countedPlaybackId = null;
        updateStatus('Listening statistics cleared.');
    } catch (error) {
        updateStatus(`Failed to clear listening statistics: ${error}`);
    } finally {
        resetting = false;
    }
}

function listenCount(plays) {
    return `${plays} ${plays === 1 ? 'listen' : 'listens'}`;
}

async function appendArtistRanking(lines, tracks, version) {
    const artists = new Map();
    let unattributed = 0;
    // Only look up paths with recorded listens. Bound each request for large histories.
    const batchSize = 256;
    for (let i = 0; i < tracks.length; i += batchSize) {
        if (version !== reportVersion) return;
        const batch = tracks.slice(i, i + batchSize);
        const metadata = await invoke('scan_metadata', { tracks: batch.map(t => t.path), preferCached: true });
        const names = new Map(metadata.map(meta => [meta.path, meta.artist?.trim()]));
        for (const { path, plays } of batch) {
            const name = names.get(path);
            if (!name) {
                unattributed += plays;
                continue;
            }
            const key = name.toLowerCase();
            const artist = artists.get(key);
            if (artist) artist.plays += plays;
            else artists.set(key, { name, plays });
        }
    }
    const ranked = [...artists.values()].sort((a, b) => b.plays - a.plays || a.name.localeCompare(b.name));
    ranked.slice(0, 10).forEach(({ name, plays }, i) => lines.push(`${i + 1}. ${name} — ${listenCount(plays)}`));
    if (unattributed) lines.push(`Unknown artist — ${listenCount(unattributed)}`);
}

export async function showListeningStats() {
    const version = ++reportVersion;
    try {
        const db = await openDatabase();
        const tracks = await new Promise((resolve, reject) => {
            const request = db.transaction('tracks').objectStore('tracks').getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        const lines = [state.settings.analytics ? 'Collection is on.' : 'Collection is off. Enable it with :set analytics.'];
        if (tracks.length) {
            tracks.sort((a, b) => b.plays - a.plays || b.lastPlayed - a.lastPlayed || a.path.localeCompare(b.path));
            const total = tracks.reduce((sum, track) => sum + track.plays, 0);
            const latest = tracks.reduce((a, b) => a.lastPlayed >= b.lastPlayed ? a : b);
            lines.push(`Listens: ${total}   Distinct tracks: ${tracks.length}`,
                `Last listen: ${fileName(latest.path)} (${new Date(latest.lastPlayed).toLocaleString()})`,
                '', 'Most-played tracks');
            const top = tracks.slice(0, 10);
            top.forEach(({ path, plays }, i) => {
                const name = fileName(path);
                const duplicate = top.some(other => other.path !== path && fileName(other.path) === name);
                lines.push(`${i + 1}. ${duplicate ? path : name} — ${listenCount(plays)}`);
            });
            lines.push('', 'Most-played artists');
            try {
                await appendArtistRanking(lines, tracks, version);
            } catch (error) {
                lines.push(`Artist information unavailable: ${error}`);
            }
        } else {
            lines.push('No qualifying listens yet.');
        }
        if (version === reportVersion) showOutput('Listening statistics', lines);
    } catch (error) {
        updateStatus(`Failed to read listening statistics: ${error}`);
    }
}
