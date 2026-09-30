const { buildDemoApp } = require('../build-common.js');

buildDemoApp({
    name: 'Social Local Demo',
    targetDir: 'demo/social-local',
    tokens: true,
    app: {
        entryPoints: ['demo/social-local/src/AppLocal.tsx'],
        outfile: 'demo/social-local/bundle.js',
    },
});
