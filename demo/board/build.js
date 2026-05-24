const esbuild = require('esbuild');
const { polyfillNode } = require('esbuild-plugin-polyfill-node');
const fs = require('fs');
const path = require('path');

async function build() {
    console.log('Building Sovereign Board Demo...');
    
    // Copy worker and sql.js assets if they don't exist
    const assets = [
        { from: 'demo/social/sync-worker.js', to: 'demo/board/sync-worker.js' },
        { from: 'node_modules/sql.js/dist/sql-wasm.wasm', to: 'demo/board/sql-wasm.wasm' }
    ];
    
    for (const asset of assets) {
        if (fs.existsSync(asset.from)) {
            fs.copyFileSync(asset.from, asset.to);
        }
    }

    try {
        await esbuild.build({
            entryPoints: ['demo/board/src/App.tsx'],
            bundle: true,
            outfile: 'demo/board/bundle.js',
            define: {
                'process.env.NODE_ENV': '"development"',
                'global': 'window',
            },
            plugins: [
                polyfillNode({
                    globals: {
                        buffer: true,
                        process: true,
                    },
                    polyfills: {
                        crypto: true,
                        fs: true,
                        os: true,
                        path: true,
                        stream: true,
                        util: true,
                        buffer: true,
                    }
                }),
            ],
            loader: {
                '.tsx': 'tsx',
                '.ts': 'ts',
                '.js': 'js',
            },
            sourcemap: true,
            minify: false, // Keep unminified for debugging the new demo
            target: ['es2020'],
        });
        console.log('Build successful!');
    } catch (err) {
        console.error('Build failed:', err);
        process.exit(1);
    }
}

build();
