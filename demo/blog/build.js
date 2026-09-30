const { buildDemoApp } = require('../build-common.js');

buildDemoApp({
    name: 'Sovereign Blog Demo',
    targetDir: 'demo/blog',
    wasm: true,
    tokens: true,
    apps: [
        {
            entryPoints: ['demo/blog/src/Editor.tsx'],
            outfile: 'demo/blog/editor-bundle.js',
        },
        {
            entryPoints: ['demo/blog/src/Reader.tsx'],
            outfile: 'demo/blog/reader-bundle.js',
        },
    ],
    worker: {
        entryPoints: ['src/worker/worker.ts'],
        outfile: 'demo/blog/sync-worker.js',
    },
});
