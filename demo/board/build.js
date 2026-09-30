const { buildDemoApp } = require('../build-common.js');

buildDemoApp({
    name: 'Sovereign Board Demo',
    targetDir: 'demo/board',
    wasm: true,
    tokens: true,
    app: {
        entryPoints: ['demo/board/src/App.tsx'],
        outfile: 'demo/board/bundle.js',
    },
    worker: {
        entryPoints: ['src/worker/worker.ts'],
        outfile: 'demo/board/sync-worker.js',
    },
});
