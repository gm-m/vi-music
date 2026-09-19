import { invoke } from './tauri.js';

const THEME_NAMES = ['default', 'gruvbox', 'catppuccin', 'light', 'custom'];
const THEME_VARIABLES = [
    'bg-primary',
    'bg-secondary',
    'bg-tertiary',
    'text-primary',
    'text-secondary',
    'text-muted',
    'accent',
    'accent-hover',
    'success',
    'warning',
    'border',
    'selection',
    'visual-selection',
    'match-background',
    'match-selection',
    'selected-match-text',
    'modal-overlay',
    'loading-overlay',
];

function clearCustomTheme() {
    for (const variable of THEME_VARIABLES) {
        document.documentElement.style.removeProperty(`--${variable}`);
    }
}

function isValidColor(value) {
    return typeof value === 'string' && !value.includes(';') && CSS.supports('color', value);
}

export function getThemeNames() {
    return [...THEME_NAMES];
}

export async function applyTheme(name) {
    const normalized = String(name).trim().toLowerCase();
    if (!THEME_NAMES.includes(normalized)) {
        throw new Error(`Unknown theme: ${name}`);
    }

    const customColors = new Map();
    if (normalized === 'custom') {
        const json = await invoke('get_custom_theme');
        const customTheme = JSON.parse(json);
        if (!customTheme || Array.isArray(customTheme) || typeof customTheme !== 'object') {
            throw new Error('theme.json must contain a JSON object');
        }

        for (const variable of THEME_VARIABLES) {
            if (!(variable in customTheme)) continue;
            if (!isValidColor(customTheme[variable])) {
                throw new Error(`Invalid color for ${variable}`);
            }
            customColors.set(variable, customTheme[variable]);
        }
        if (customColors.size === 0) {
            throw new Error('theme.json does not contain any supported colors');
        }
    }

    clearCustomTheme();
    document.documentElement.dataset.theme = normalized;
    for (const [variable, value] of customColors) {
        document.documentElement.style.setProperty(`--${variable}`, value);
    }

    return normalized;
}
