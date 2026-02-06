import { invoke } from './tauri.js';
import { state } from './state.js';
import { updateStatus } from './ui.js';
import { renderCurrentView } from './filter.js';

export async function loadSettings() {
    try {
        const json = await invoke('get_settings');
        const saved = JSON.parse(json);
        // Merge saved settings with defaults
        state.settings = { ...state.settings, ...saved };
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

export function handleSetCommand(arg) {
    const trimmed = arg.trim();
    
    // Handle "no" prefix to disable (e.g., "norelativenumber")
    if (trimmed.startsWith('no')) {
        const setting = trimmed.slice(2);
        if (setting in state.settings) {
            state.settings[setting] = false;
            saveSettings();
            renderCurrentView();
            updateStatus(`${setting} disabled`);
            return;
        }
    }
    
    // Handle "setting!" to toggle
    if (trimmed.endsWith('!')) {
        const setting = trimmed.slice(0, -1);
        if (setting in state.settings) {
            state.settings[setting] = !state.settings[setting];
            saveSettings();
            renderCurrentView();
            updateStatus(`${setting} ${state.settings[setting] ? 'enabled' : 'disabled'}`);
            return;
        }
    }
    
    // Handle "setting?" to query
    if (trimmed.endsWith('?')) {
        const setting = trimmed.slice(0, -1);
        if (setting in state.settings) {
            updateStatus(`${setting}=${state.settings[setting]}`);
            return;
        }
    }
    
    // Handle "setting=value"
    if (trimmed.includes('=')) {
        const [setting, value] = trimmed.split('=');
        if (setting in state.settings) {
            if (value === 'true' || value === '1') {
                state.settings[setting] = true;
            } else if (value === 'false' || value === '0') {
                state.settings[setting] = false;
            } else {
                state.settings[setting] = value;
            }
            saveSettings();
            renderCurrentView();
            updateStatus(`${setting}=${state.settings[setting]}`);
            return;
        }
    }
    
    // Handle just setting name to enable
    if (trimmed in state.settings) {
        state.settings[trimmed] = true;
        saveSettings();
        renderCurrentView();
        updateStatus(`${trimmed} enabled`);
        return;
    }
    
    // Aliases
    const aliases = {
        'rnu': 'relativenumber',
        'rn': 'relativenumber',
        'nu': 'number',
    };
    
    if (aliases[trimmed]) {
        state.settings[aliases[trimmed]] = true;
        saveSettings();
        renderCurrentView();
        updateStatus(`${aliases[trimmed]} enabled`);
        return;
    }
    
    if (trimmed.startsWith('no') && aliases[trimmed.slice(2)]) {
        state.settings[aliases[trimmed.slice(2)]] = false;
        saveSettings();
        renderCurrentView();
        updateStatus(`${aliases[trimmed.slice(2)]} disabled`);
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
