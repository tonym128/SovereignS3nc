const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'demo-dist');
const port = parseInt(process.env.PORT || '8899', 10);

// Build demos if not present
if (!fs.existsSync(distDir) || !fs.existsSync(path.join(distDir, 'index.html'))) {
    console.log('📦 demo-dist not found, building demos first...');
    execSync('node scripts/build-demos.js', { cwd: rootDir, stdio: 'inherit' });
}

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.wasm': 'application/wasm',
    '.map': 'application/json; charset=utf-8'
};

const server = http.createServer((req, res) => {
    let reqPath = decodeURI(req.url.split('?')[0]);
    if (reqPath === '/' || reqPath.endsWith('/')) {
        reqPath += 'index.html';
    }

    let filePath = path.join(distDir, reqPath);

    // If it is a directory without trailing slash, redirect to trailing slash or serve index.html
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`404 Not Found: ${req.url}`);
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Headers allowing local testing and wasm execution
    res.writeHead(200, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
});

server.listen(port, '127.0.0.1', () => {
    console.log(`🌐 Demo Distribution Server running at http://127.0.0.1:${port}`);
});

process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
    server.close(() => process.exit(0));
});
