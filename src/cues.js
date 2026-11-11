import { invoke, open } from './tauri.js';
import { state } from './state.js';
import { updateStatus, updateProgressDisplay, showOutput } from './ui.js';
import { seekTo, getElapsed } from './playback.js';
import { loadBookmarks } from './features.js';
import { formatPreciseTime } from './utils.js';

// Pressing "previous cue" within this many seconds after a cue skips to the one before it
const PREV_CUE_GRACE_SECS = 2;
// Cues closer than this are considered the same cue (matches the backend)
const CUE_DEDUP_SECS = 0.05;

export async function loadCues() {
    try {
        state.cues = await invoke('get_cues');
    } catch (err) {
        console.error('Failed to load cues:', err);
        state.cues = {};
    }
}

function getPlayingTrack() {
    const track = state.isPlaying ? state.playlist[state.playingIndex] : null;
    if (!track) updateStatus('No track playing');
    return track ?? null;
}

export function getTrackCues(path) {
    return state.cues[path] ?? [];
}

export function describeCue(cue, index) {
    return `${index + 1}:${formatPreciseTime(cue.time)}${cue.label ? ` ${cue.label}` : ''}`;
}

// Persist cues for a track; the backend returns them sorted and deduplicated
async function saveTrackCues(path, cues) {
    try {
        const saved = await invoke('set_track_cues', { path, cues });
        if (saved.length > 0) {
            state.cues[path] = saved;
        } else {
            delete state.cues[path];
        }
        updateProgressDisplay();
        return saved;
    } catch (err) {
        console.error('Failed to save cues:', err);
        updateStatus(`Failed to save cues: ${err}`);
        return null;
    }
}

function findCueIndex(cues, time) {
    return cues.findIndex(c => Math.abs(c.time - time) < CUE_DEDUP_SECS);
}

export async function addCue(position = null, label = null) {
    const track = getPlayingTrack();
    if (!track) return;
    
    const raw = position ?? getElapsed();
    const time = Math.round(Math.max(0, state.duration ? Math.min(raw, state.duration) : raw) * 100) / 100;
    const cues = getTrackCues(track.path);
    if (findCueIndex(cues, time) !== -1) {
        updateStatus(`Cue already exists at ${formatPreciseTime(time)}`);
        return;
    }
    
    const saved = await saveTrackCues(track.path, [...cues, { time, label }]);
    if (!saved) return;
    const index = findCueIndex(saved, time);
    updateStatus(`Cue added: ${describeCue(saved[index], index)} (${saved.length} total)`);
}

// Resolve a 1-based cue number, or the cue nearest to the current position when null
function resolveCueIndex(cues, number) {
    if (cues.length === 0) {
        updateStatus('No cues for this track');
        return -1;
    }
    if (number === null) {
        const now = getElapsed();
        return cues.reduce((best, c, i) =>
            Math.abs(c.time - now) < Math.abs(cues[best].time - now) ? i : best, 0);
    }
    if (number < 1 || number > cues.length) {
        updateStatus(`Invalid cue number. Track has ${cues.length} cue${cues.length !== 1 ? 's' : ''}`);
        return -1;
    }
    return number - 1;
}

export async function deleteCue(number = null) {
    const track = getPlayingTrack();
    if (!track) return;
    
    const cues = getTrackCues(track.path);
    const index = resolveCueIndex(cues, number);
    if (index === -1) return;
    
    if (await saveTrackCues(track.path, cues.filter((_, i) => i !== index))) {
        updateStatus(`Cue deleted: ${describeCue(cues[index], index)}`);
    }
}

// Set (or clear, if empty) the label of cue n, or of the nearest cue when number is null
export async function labelCue(number, label) {
    const track = getPlayingTrack();
    if (!track) return;
    
    const cues = getTrackCues(track.path);
    const index = resolveCueIndex(cues, number);
    if (index === -1) return;
    
    const updated = cues.map((c, i) => (i === index ? { ...c, label: label || null } : c));
    if (await saveTrackCues(track.path, updated)) {
        updateStatus(label ? `Cue ${index + 1} labeled "${label}"` : `Cue ${index + 1} label cleared`);
    }
}

export async function clearCues() {
    const track = getPlayingTrack();
    if (!track) return;
    if (await saveTrackCues(track.path, [])) {
        updateStatus('Cues cleared for this track');
    }
}

export function listCues() {
    const track = getPlayingTrack();
    if (!track) return;
    
    const cues = getTrackCues(track.path);
    if (cues.length === 0) {
        updateStatus('No cues for this track. Use :cue add [m:ss] [label]');
        return;
    }
    showOutput(`Cues: ${track.name}`, cues.map((cue, i) =>
        `${String(i + 1).padStart(2)}.  ${formatPreciseTime(cue.time).padStart(8)}  ${cue.label ?? ''}`));
}

async function jumpToCue(cues, cue) {
    if (await seekTo(cue.time) === undefined) return;
    updateStatus(`Cue ${describeCue(cue, cues.indexOf(cue))} (${cues.length} total)`);
}

export async function jumpToNextCue(count = 1) {
    const track = getPlayingTrack();
    if (!track) return;
    
    const cues = getTrackCues(track.path);
    const now = getElapsed();
    const ahead = cues.filter(c => c.time > now + CUE_DEDUP_SECS);
    if (ahead.length === 0) {
        updateStatus(cues.length ? 'No next cue' : 'No cues for this track');
        return;
    }
    await jumpToCue(cues, ahead[Math.min(count, ahead.length) - 1]);
}

export async function jumpToPrevCue(count = 1) {
    const track = getPlayingTrack();
    if (!track) return;
    
    const cues = getTrackCues(track.path);
    const now = getElapsed();
    const behind = cues.filter(c => c.time < now - PREV_CUE_GRACE_SECS).reverse();
    if (behind.length === 0) {
        updateStatus(cues.length ? 'No previous cue' : 'No cues for this track');
        return;
    }
    await jumpToCue(cues, behind[Math.min(count, behind.length) - 1]);
}

// Default CUE sheet location: next to the audio file, same base name
function defaultCuePath(audioPath) {
    return audioPath.replace(/\.[^.\\/]+$/, '') + '.cue';
}

export async function exportCues(cuePath = null, overwrite = false) {
    const track = getPlayingTrack();
    if (!track) return;
    
    const cues = getTrackCues(track.path);
    if (cues.length === 0) {
        updateStatus('No cues to export');
        return;
    }
    
    const target = cuePath || defaultCuePath(track.path);
    try {
        await invoke('export_cue_sheet', {
            audioPath: track.path,
            cuePath: target,
            title: track.name.replace(/\.[^.]+$/, ''),
            cues,
            overwrite,
        });
        updateStatus(`Exported ${cues.length} cue${cues.length !== 1 ? 's' : ''} to ${target}`);
    } catch (err) {
        updateStatus(`Export failed: ${err}`);
    }
}

// Merge cues from a CUE sheet into the playing track's cues
export async function importCues(cuePath = null) {
    const track = getPlayingTrack();
    if (!track) return;
    
    const source = cuePath || await open({
        multiple: false,
        title: 'Import CUE sheet',
        defaultPath: defaultCuePath(track.path),
        filters: [{ name: 'CUE sheet', extensions: ['cue'] }],
    });
    if (!source) return;
    
    try {
        const imported = await invoke('import_cue_sheet', { audioPath: track.path, cuePath: source });
        const existing = getTrackCues(track.path);
        const added = imported.filter(c => findCueIndex(existing, c.time) === -1);
        if (added.length === 0) {
            updateStatus(imported.length ? 'All cues already present' : 'No cues found in CUE sheet');
            return;
        }
        if (await saveTrackCues(track.path, [...existing, ...added])) {
            updateStatus(`Imported ${added.length} cue${added.length !== 1 ? 's' : ''} from ${source}`);
        }
    } catch (err) {
        updateStatus(`Import failed: ${err}`);
    }
}

// Remove cues/bookmarks/cached metadata of files that no longer exist on disk
export async function pruneMissing() {
    try {
        const result = await invoke('prune_missing');
        await Promise.all([loadCues(), loadBookmarks()]);
        updateProgressDisplay();
        updateStatus(`Pruned missing files: ${result.cues} with cues, ${result.bookmarks} bookmark${result.bookmarks !== 1 ? 's' : ''}, ${result.metadata} cached metadata`);
    } catch (err) {
        updateStatus(`Prune failed: ${err}`);
    }
}
