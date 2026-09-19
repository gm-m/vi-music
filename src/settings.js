import { invoke } from './tauri.js';
import { state } from './state.js';
import { updateStatus, updateProgressDisplay } from './ui.js';
import { renderCurrentView } from './filter.js';
import { applyTheme } from './themes.js';

export async function loadSettings() {
    try {
        const json = await invoke('get_settings');
        const saved = JSON.parse(json);
        // Merge saved settings with defaults
        state.settings = { ...state.settings, ...saved };
        try {
            state.settings.theme = await applyTheme(state.settings.theme);
        } catch (err) {
            console.error('Failed to load theme:', err);
            state.settings.theme = await applyTheme('default');
        }
    } catch (err) {
        console.error('Failed to load settings:', err);
    }
}

export async function saveSettings() {
    try {
        await invoke('save_settings', { settings: JSON.stringify(state.settings) });
    } catch (err) {
        console.error('Failed to save settings:', err);
    }
}

export async function handleSetCommand(arg) {
    const trimmed = arg.trim();
    
    // Aliases for setting names
    const aliases = {
        'rnu': 'relativenumber',
        'rn': 'relativenumber',
        'nu': 'number',
        'st': 'seektime',
        'stl': 'seektimelarge',
        'ss': 'speedstep',
        'vs': 'volumestep',
        'cp': 'carryposition',
        'rt': 'remainingtime',
        'th': 'theme',
    };
    
    // Handle "no" prefix to disable (e.g., "norelativenumber")
    if (trimmed.startsWith('no')) {
        const setting = trimmed.slice(2);
        const resolved = aliases[setting] || setting;
        if (resolved in state.settings && typeof state.settings[resolved] === 'boolean') {
            state.settings[resolved] = false;
            saveSettings();
            renderCurrentView();
            updateProgressDisplay();
            updateStatus(`${resolved} disabled`);
            return;
        }
    }
    
    // Handle "setting!" to toggle
    if (trimmed.endsWith('!')) {
        const setting = trimmed.slice(0, -1);
        const resolved = aliases[setting] || setting;
        if (resolved in state.settings && typeof state.settings[resolved] === 'boolean') {
            state.settings[resolved] = !state.settings[resolved];
            saveSettings();
            renderCurrentView();
            updateProgressDisplay();
            updateStatus(`${resolved} ${state.settings[resolved] ? 'enabled' : 'disabled'}`);
            return;
        }
    }
    
    // Handle "setting?" to query
    if (trimmed.endsWith('?')) {
        const setting = trimmed.slice(0, -1);
        const resolved = aliases[setting] || setting;
        if (resolved in state.settings) {
            updateStatus(`${resolved}=${state.settings[resolved]}`);
            return;
        }
    }
    
    // Handle "setting=value"
    if (trimmed.includes('=')) {
        const [setting, value] = trimmed.split('=');
        const resolvedSetting = aliases[setting] || setting;
        if (resolvedSetting in state.settings) {
            if (resolvedSetting === 'theme') {
                try {
                    state.settings.theme = await applyTheme(value);
                    await saveSettings();
                    updateStatus(`theme=${state.settings.theme}`);
                } catch (err) {
                    updateStatus(`Failed to apply theme: ${err.message || err}`);
                }
                return;
            }
            const currentType = typeof state.settings[resolvedSetting];
            if (currentType === 'boolean') {
                state.settings[resolvedSetting] = value === 'true' || value === '1';
            } else if (currentType === 'number') {
                const num = parseFloat(value);
                if (!isNaN(num) && num > 0) {
                    state.settings[resolvedSetting] = num;
                } else {
                    updateStatus(`Invalid value for ${resolvedSetting}: must be a positive number`);
                    return;
                }
            } else {
                state.settings[resolvedSetting] = value;
            }
            saveSettings();
            renderCurrentView();
            updateStatus(`${resolvedSetting}=${state.settings[resolvedSetting]}`);
            return;
        }
    }
    
    // Handle just setting name to enable (for boolean settings)
    const resolvedName = aliases[trimmed] || trimmed;
    if (resolvedName in state.settings) {
        if (typeof state.settings[resolvedName] === 'boolean') {
            state.settings[resolvedName] = true;
            saveSettings();
            renderCurrentView();
            updateProgressDisplay();
            updateStatus(`${resolvedName} enabled`);
        } else {
            updateStatus(`${resolvedName}=${state.settings[resolvedName]} (use :set ${resolvedName}=<value> to change)`);
        }
        return;
    }
    
    updateStatus(`Unknown setting: ${trimmed}`);
}

export function showCurrentSettings() {
    const settings = Object.entries(state.settings)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
    updateStatus(`Settings: ${settings}`);
}
