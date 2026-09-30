const { buildDemoApp } = require('../build-common.js');

buildDemoApp({
    name: 'Social Demo',
    targetDir: 'demo/social',
    tokens: true,
    app: {
        entryPoints: ['demo/social/src/App.tsx'],
        outfile: 'demo/social/bundle.js',
    },
    worker: {
        entryPoints: ['src/worker/worker.ts'],
        outfile: 'demo/social/sync-worker.js',
    },
});
