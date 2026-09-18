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

    // 3. Ensure wasm is present in board and blog
    const wasmSource = path.join(rootDir, 'node_modules/sql.js/dist/sql-wasm.wasm');
    if (fs.existsSync(wasmSource)) {
        fs.copyFileSync(wasmSource, path.join(outDir, 'board/sql-wasm.wasm'));
        fs.copyFileSync(wasmSource, path.join(outDir, 'blog/sql-wasm.wasm'));
    }

    // 4. Copy root demo portal landing page and icons
    fs.copyFileSync(path.join(rootDir, 'demo/index.html'), path.join(outDir, 'index.html'));
    fs.writeFileSync(path.join(outDir, '.nojekyll'), '');

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
