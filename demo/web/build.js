const { buildDemoApp } = require('../build-common.js');

buildDemoApp({
    name: 'Web Demo',
    targetDir: 'demo/web',
    tokens: true,
    app: {
        entryPoints: ['demo/web/src/App.tsx'],
        outfile: 'demo/web/bundle.js',
    },
});
