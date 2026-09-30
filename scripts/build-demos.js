const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function buildAllDemos() {
    console.log('🚀 Starting Unified SovereignS3nc Demo Sandbox Build...');

    const rootDir = path.resolve(__dirname, '..');
    const outDir = path.join(rootDir, 'demo-dist');

    // 1. Clean and initialize demo-dist directory
    if (fs.existsSync(outDir)) {
        fs.rmSync(outDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outDir, { recursive: true });

    // 2. Build individual demos
    const demos = [
        { name: 'Social', script: 'demo/social/build.js', srcDir: 'demo/social', targetDir: 'social' },
        { name: 'Social Local', script: 'demo/social-local/build.js', srcDir: 'demo/social-local', targetDir: 'social-local' },
        { name: 'Banky', script: 'demo/banky/build.js', srcDir: 'demo/banky', targetDir: 'banky' },
        { name: 'Board', script: 'demo/board/build.js', srcDir: 'demo/board', targetDir: 'board' },
        { name: 'Blog', script: 'demo/blog/build.js', srcDir: 'demo/blog', targetDir: 'blog' },
    ];

    for (const demo of demos) {
        console.log(`📦 Building ${demo.name}...`);
        execSync(`node --no-warnings ${demo.script}`, { cwd: rootDir, stdio: 'inherit' });

        const targetPath = path.join(outDir, demo.targetDir);
        fs.mkdirSync(targetPath, { recursive: true });

        const sourcePath = path.join(rootDir, demo.srcDir);
        const files = fs.readdirSync(sourcePath);

        for (const file of files) {
            // Ignore source directories and build scripts in distribution
            if (['src', 'build.js', 'node_modules', '.DS_Store'].includes(file)) continue;

            const srcFile = path.join(sourcePath, file);
            const dstFile = path.join(targetPath, file);

            if (fs.statSync(srcFile).isFile()) {
                fs.copyFileSync(srcFile, dstFile);
            }
        }
    }

    // 3. Ensure wasm is present in board, blog, and playground
    const wasmSource = path.join(rootDir, 'node_modules/sql.js/dist/sql-wasm.wasm');
    const wasmJsSource = path.join(rootDir, 'node_modules/sql.js/dist/sql-wasm.js');
    if (fs.existsSync(wasmSource)) {
        fs.copyFileSync(wasmSource, path.join(outDir, 'board/sql-wasm.wasm'));
        fs.copyFileSync(wasmSource, path.join(outDir, 'blog/sql-wasm.wasm'));
    }

    // 4. Copy Interactive Playground
    const playgroundSrcDir = path.join(rootDir, 'demo/playground');
    const playgroundDstDir = path.join(outDir, 'playground');
    if (fs.existsSync(playgroundSrcDir)) {
        fs.mkdirSync(playgroundDstDir, { recursive: true });
        const playgroundFiles = fs.readdirSync(playgroundSrcDir);
        for (const file of playgroundFiles) {
            const src = path.join(playgroundSrcDir, file);
            if (fs.statSync(src).isFile()) {
                fs.copyFileSync(src, path.join(playgroundDstDir, file));
            }
        }
        if (fs.existsSync(wasmSource)) {
            fs.copyFileSync(wasmSource, path.join(playgroundDstDir, 'sql-wasm.wasm'));
        }
        if (fs.existsSync(wasmJsSource)) {
            fs.copyFileSync(wasmJsSource, path.join(playgroundDstDir, 'sql-wasm.js'));
        }
    }

    // 5. Copy Global SovereignS3nc Browser Bundle to root and playground for offline/standalone execution
    const globalBundle = path.join(rootDir, 'dist/sovereigns3nc.global.js');
    const globalBundleMap = path.join(rootDir, 'dist/sovereigns3nc.global.js.map');
    if (!fs.existsSync(globalBundle)) {
        try {
            execSync('npm run build:global', { cwd: rootDir, stdio: 'inherit' });
        } catch (e) {
            console.warn('Could not auto-build sovereigns3nc.global.js:', e);
        }
    }
    if (fs.existsSync(globalBundle)) {
        fs.copyFileSync(globalBundle, path.join(outDir, 'sovereigns3nc.global.js'));
        if (fs.existsSync(playgroundDstDir)) {
            fs.copyFileSync(globalBundle, path.join(playgroundDstDir, 'sovereigns3nc.global.js'));
        }
    }
    if (fs.existsSync(globalBundleMap)) {
        fs.copyFileSync(globalBundleMap, path.join(outDir, 'sovereigns3nc.global.js.map'));
        if (fs.existsSync(playgroundDstDir)) {
            fs.copyFileSync(globalBundleMap, path.join(playgroundDstDir, 'sovereigns3nc.global.js.map'));
        }
    }

    // 6. Copy Quickstart Starter Example to demo-dist for hosted download & inspection
    const quickstartSrc = path.join(rootDir, 'examples/quickstart');
    const quickstartDst = path.join(outDir, 'examples/quickstart');
    if (fs.existsSync(quickstartSrc)) {
        const copyDirRecursive = (src, dest) => {
            fs.mkdirSync(dest, { recursive: true });
            for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
                const s = path.join(src, entry.name);
                const d = path.join(dest, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name !== 'node_modules' && entry.name !== 'dist') {
                        copyDirRecursive(s, d);
                    }
                } else {
                    fs.copyFileSync(s, d);
                }
            }
        };
        copyDirRecursive(quickstartSrc, quickstartDst);
    }

    // 7. Copy root demo portal landing page, shared tokens, and icons
    fs.copyFileSync(path.join(rootDir, 'demo/index.html'), path.join(outDir, 'index.html'));
    fs.writeFileSync(path.join(outDir, '.nojekyll'), '');

    const sharedTokensSrc = path.join(rootDir, 'demo/shared/src/tokens.css');
    if (fs.existsSync(sharedTokensSrc)) {
        fs.mkdirSync(path.join(outDir, 'shared'), { recursive: true });
        fs.copyFileSync(sharedTokensSrc, path.join(outDir, 'shared/tokens.css'));
        fs.copyFileSync(sharedTokensSrc, path.join(outDir, 'tokens.css'));
    }

    // Copy icons to root if available
    const iconFiles = ['favicon.ico', 'favicon.png', 'icon-192.png', 'icon-512.png'];
    for (const icon of iconFiles) {
        const iconPath = path.join(rootDir, 'demo/social', icon);
        if (fs.existsSync(iconPath)) {
            fs.copyFileSync(iconPath, path.join(outDir, icon));
        }
    }

    console.log('✅ SovereignS3nc Demo Sandbox build completed successfully!');
    console.log(`📁 Target distribution: ${outDir}`);
}

buildAllDemos().catch(err => {
    console.error('❌ Demo Sandbox build failed:', err);
    process.exit(1);
});
