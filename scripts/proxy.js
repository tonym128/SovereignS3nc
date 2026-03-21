const http = require('http');

const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = 3900;
const PROXY_PORT = process.env.PROXY_PORT || 8889;

const server = http.createServer((req, res) => {
  const timestamp = new Date().toISOString();
  // LOG IMMEDIATELY when any request hits the server
  console.log(`[Proxy] >>> RECEIVED: ${req.method} ${req.url} from ${req.socket.remoteAddress}`);

  // 1. SET CORS HEADERS IMMEDIATELY
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', '*');

  // 2. HANDLE PING
  if (req.url === '/_ping') {
    console.log(`[Proxy] Responding to /_ping`);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('pong');
    return;
  }

  // 3. HANDLE PREFLIGHT
  if (req.method === 'OPTIONS') {
    console.log(`[Proxy] Responding to OPTIONS (Preflight)`);
    res.writeHead(204);
    res.end();
    return;
  }

  // 4. FORWARD TO GARAGE
  // WARNING: S3 Signature V4 is extremely sensitive to the 'host' header.
  // If this proxy is used as an S3 endpoint, the client will sign for PROXY_PORT.
  // If we change the host or port here, the signature will become invalid.
  // It is highly recommended to enable CORS on the S3 provider directly 
  // and connect to it without this proxy.
  const headers = { ...req.headers };

  const options = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: headers,
    timeout: 10000 // 10s timeout for garage
  };

  console.log(`[Proxy] Forwarding to Garage: http://${TARGET_HOST}:${TARGET_PORT}${req.url}`);

  const connector = http.request(options, (targetRes) => {
    console.log(`[Proxy] <<< GARAGE RESPONSE: ${targetRes.statusCode} for ${req.url}`);
    
    const outHeaders = { ...targetRes.headers };
    outHeaders['Access-Control-Allow-Origin'] = '*';
    
    res.writeHead(targetRes.statusCode, outHeaders);
    targetRes.pipe(res, { end: true });
  });

  // Pipe request body
  req.pipe(connector, { end: true });

  connector.on('error', (e) => {
    console.error(`[Proxy Error] Garage connection failed: ${e.message}`);
    if (!res.headersSent) {
        res.writeHead(502);
        res.end(`Proxy Error: ${e.message}`);
    }
  });

  connector.on('timeout', () => {
    console.error(`[Proxy Error] Garage timed out`);
    connector.destroy();
    if (!res.headersSent) {
        res.writeHead(504);
        res.end('Garage Timeout');
    }
  });
});

server.on('error', (e) => {
    console.error(`[Proxy Server Error] ${e.message}`);
});

process.on('uncaughtException', (err) => {
    console.error(`[Proxy Uncaught Exception] ${err.message}`);
    console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Proxy Unhandled Rejection] at:', promise, 'reason:', reason);
});

// Explicitly bind to 0.0.0.0 to ensure it's reachable
server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`[Proxy] CORS Proxy listening on http://0.0.0.0:${PROXY_PORT} -> http://${TARGET_HOST}:${TARGET_PORT}`);
});
