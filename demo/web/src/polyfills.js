import { Buffer } from 'buffer';
window.Buffer = Buffer;
window.global = window;
window.process = { 
    env: { NODE_ENV: 'development' }, 
    nextTick: (fn) => setTimeout(fn, 0),
    version: 'v18.0.0',
    versions: {},
    browser: true
};

window.require = (name) => {
    console.warn(`Browser: dynamic require of "${name}" suppressed.`);
    return {};
};

window.addEventListener('error', (e) => {
    console.error('GLOBAL ERROR:', e.error);
    document.body.innerHTML += `<div class="alert alert-danger">Runtime Error: ${e.message}</div>`;
});