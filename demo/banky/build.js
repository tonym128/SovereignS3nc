const { buildDemoApp } = require('../build-common.js');

buildDemoApp({
    name: 'Banky Demo',
    targetDir: 'demo/banky',
    tokens: true,
    app: {
        entryPoints: ['demo/banky/src/App.tsx'],
        outfile: 'demo/banky/bundle.js',
    },
    worker: {
        entryPoints: ['src/worker/worker.ts'],
        outfile: 'demo/banky/sync-worker.js',
    },
});
