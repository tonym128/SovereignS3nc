const esbuild = require('esbuild');

esbuild.build({
    entryPoints: ['demo/web/src/App.tsx'],
    bundle: true,
    outfile: 'demo/web/bundle.js',
    platform: 'browser',
    format: 'iife',
    define: {
        'process.env.NODE_ENV': '"development"',
        'global': 'window',
        'process.version': '"v18.0.0"'
    },
    alias: {
        'path': 'path-browserify',
        'crypto': 'crypto-browserify',
        'stream': 'stream-browserify',
        'buffer': 'buffer',
        'util': 'util',
        'events': 'events',
        'assert': 'assert',
        'process': 'process/browser'
    },
    inject: ['./demo/web/src/polyfills.js'],
}).catch((e) => {
    console.error(e);
    process.exit(1)
});
