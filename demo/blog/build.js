const esbuild = require('esbuild');
const { polyfillNode } = require('esbuild-plugin-polyfill-node');
const fs = require('fs');
const path = require('path');

async function build() {
    console.log('Building Sovereign Blog Demo...');
    
    const assets = [
        { from: 'demo/social/sync-worker.js', to: 'demo/blog/sync-worker.js' },
        { from: 'node_modules/sql.js/dist/sql-wasm.wasm', to: 'demo/blog/sql-wasm.wasm' }
    ];
    
    for (const asset of assets) {
        if (fs.existsSync(asset.from)) {
            fs.copyFileSync(asset.from, asset.to);
        }
    }

    const commonConfig = {
        bundle: true,
        define: {
            'process.env.NODE_ENV': '"development"',
            'global': 'window',
        },
        plugins: [
            polyfillNode({
                globals: { buffer: true, process: true },
                polyfills: { crypto: true, fs: true, os: true, path: true, stream: true, util: true, buffer: true }
            }),
        ],
        loader: { '.tsx': 'tsx', '.ts': 'ts', '.js': 'js' },
        sourcemap: true,
        minify: false,
        target: ['es2020'],
    };

    try {
        await Promise.all([
            esbuild.build({
                ...commonConfig,
                entryPoints: ['demo/blog/src/Editor.tsx'],
                outfile: 'demo/blog/editor-bundle.js',
            }),
            esbuild.build({
                ...commonConfig,
                entryPoints: ['demo/blog/src/Reader.tsx'],
                outfile: 'demo/blog/reader-bundle.js',
            })
        ]);
        console.log('Build successful!');
    } catch (err) {
        console.error('Build failed:', err);
        process.exit(1);
    }
}

build();
