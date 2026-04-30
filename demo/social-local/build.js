const esbuild = require('esbuild');

// Main App Build
esbuild.build({
    entryPoints: ['demo/social-local/src/AppLocal.tsx'],
    bundle: true,
    outfile: 'demo/social-local/bundle.js',
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
    external: ['fs-extra', 'path', 'fs'],
    inject: ['./demo/social-local/src/polyfills.js'],
}).catch((e) => {
    console.error(e);
    process.exit(1)
});
