import { invoke } from './tauri.js';
import { updateStatus } from './ui.js';

export async function getAudioDevices() {
    return await invoke('list_audio_devices');
}

export async function showAudioDevices() {
    const devices = await getAudioDevices();
    if (devices.length === 0) {
        updateStatus('No audio output devices found');
    } else {
        const list = devices.map((d, i) => `${i + 1}. ${d}`).join('\n');
        updateStatus(`Audio devices:\n${list}\nUse :device <number> to switch`);
    }
}

export async function setAudioDevice(deviceName) {
    await invoke('set_audio_device', { deviceName });
    updateStatus(`Audio output: ${deviceName || 'Default'}`);
}

export async function setAudioDeviceByIndex(index) {
    const devices = await getAudioDevices();
    if (index >= 0 && index < devices.length) {
        await setAudioDevice(devices[index]);
    } else {
        updateStatus('Invalid device number. Use :devices to see list');
    }
}
