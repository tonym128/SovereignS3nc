import { Buffer } from 'buffer';
window.Buffer = Buffer;
window.global = window;
window.process = { env: { NODE_ENV: 'development' }, nextTick: (fn) => setTimeout(fn, 0) };
