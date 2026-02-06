// Tauri API initialization
let invoke, open, listen;

if (window.__TAURI__) {
    invoke = window.__TAURI__.tauri?.invoke || window.__TAURI__.invoke;
    open = window.__TAURI__.dialog?.open;
    listen = window.__TAURI__.event?.listen;
} else {
    console.warn('Tauri API not available');
    invoke = async () => { throw new Error('Tauri not available'); };
    open = async () => null;
    listen = async () => () => {};
}

export { invoke, open, listen };
