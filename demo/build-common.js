const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEMO_DIR = __dirname;
const SHARED_DIR = path.join(__dirname, 'shared');
const SHARED_SRC_DIR = path.join(SHARED_DIR, 'src');
const SHARED_POLYFILLS = path.join(SHARED_SRC_DIR, 'polyfills.js');
const SHARED_TOKENS = path.join(SHARED_SRC_DIR, 'tokens.css');
const SQL_WASM_SOURCE = path.join(ROOT_DIR, 'node_modules/sql.js/dist/sql-wasm.wasm');
const SQL_WASM_JS_SOURCE = path.join(ROOT_DIR, 'node_modules/sql.js/dist/sql-wasm.js');

const DEFAULT_ALIASES = {
  path: 'path-browserify',
  crypto: 'crypto-browserify',
  stream: 'stream-browserify',
  buffer: 'buffer',
  util: 'util',
  events: 'events',
  assert: 'assert',
  process: 'process/browser',
  '@sovereigns3nc/demo-shared': path.join(SHARED_SRC_DIR, 'index.ts'),
  '@sovereign-s3nc/demo-shared': path.join(SHARED_SRC_DIR, 'index.ts'),
};

const DEFAULT_DEFINES = {
  'process.env.NODE_ENV': '"development"',
  global: 'window',
  'process.version': '"v18.0.0"',
};

const DEFAULT_WORKER_DEFINES = {
  'process.env.NODE_ENV': '"development"',
  global: 'self',
  'process.version': '"v18.0.0"',
};

const DEFAULT_EXTERNALS = ['fs-extra', 'fs', 'path'];

const DEFAULT_LOADERS = {
  '.tsx': 'tsx',
  '.ts': 'ts',
  '.js': 'js',
  '.css': 'text',
};

function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.join(ROOT_DIR, p);
}

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copyAssets(assets = []) {
  const copied = [];
  for (const asset of assets) {
    const fromPath = resolvePath(asset.from);
    const toPath = resolvePath(asset.to);

    if (fs.existsSync(fromPath)) {
      ensureDirSync(path.dirname(toPath));
      fs.copyFileSync(fromPath, toPath);
      copied.push({ from: fromPath, to: toPath });
    }
  }
  return copied;
}

function copyWasmAssets(targetDir) {
  const resolvedTarget = resolvePath(targetDir);
  ensureDirSync(resolvedTarget);

  const assets = [
    { from: SQL_WASM_SOURCE, to: path.join(resolvedTarget, 'sql-wasm.wasm') },
    { from: SQL_WASM_JS_SOURCE, to: path.join(resolvedTarget, 'sql-wasm.js') },
  ];
  return copyAssets(assets);
}

function copyTokens(targetDir) {
  const resolvedTarget = resolvePath(targetDir);
  ensureDirSync(resolvedTarget);
  return copyAssets([
    { from: SHARED_TOKENS, to: path.join(resolvedTarget, 'tokens.css') },
  ]);
}

function createAppConfig(options = {}) {
  const entryPoints = options.entryPoints || (options.entryPoint ? [options.entryPoint] : []);
  const resolvedEntryPoints = entryPoints.map(resolvePath);
  const resolvedOutfile = options.outfile ? resolvePath(options.outfile) : undefined;
  const resolvedOutdir = options.outdir ? resolvePath(options.outdir) : undefined;

  return {
    entryPoints: resolvedEntryPoints,
    bundle: options.bundle !== undefined ? options.bundle : true,
    ...(resolvedOutfile ? { outfile: resolvedOutfile } : {}),
    ...(resolvedOutdir ? { outdir: resolvedOutdir } : {}),
    platform: options.platform || 'browser',
    format: options.format || 'iife',
    sourcemap: options.sourcemap !== undefined ? options.sourcemap : true,
    target: options.target || ['es2020'],
    minify: options.minify || false,
    define: {
      ...DEFAULT_DEFINES,
      ...(options.define || {}),
    },
    alias: {
      ...DEFAULT_ALIASES,
      ...(options.alias || {}),
    },
    external: options.external || DEFAULT_EXTERNALS,
    inject: options.inject || (fs.existsSync(SHARED_POLYFILLS) ? [SHARED_POLYFILLS] : []),
    loader: {
      ...DEFAULT_LOADERS,
      ...(options.loader || {}),
    },
    ...(options.plugins ? { plugins: options.plugins } : {}),
  };
}

function createWorkerConfig(options = {}) {
  const entryPoints = options.entryPoints || (options.entryPoint ? [options.entryPoint] : ['src/worker/worker.ts']);
  const resolvedEntryPoints = entryPoints.map(resolvePath);
  const resolvedOutfile = options.outfile ? resolvePath(options.outfile) : undefined;

  return {
    entryPoints: resolvedEntryPoints,
    bundle: options.bundle !== undefined ? options.bundle : true,
    ...(resolvedOutfile ? { outfile: resolvedOutfile } : {}),
    platform: 'browser',
    format: 'iife',
    sourcemap: options.sourcemap !== undefined ? options.sourcemap : true,
    target: options.target || ['es2020'],
    minify: options.minify || false,
    define: {
      ...DEFAULT_WORKER_DEFINES,
      ...(options.define || {}),
    },
    alias: {
      ...DEFAULT_ALIASES,
      ...(options.alias || {}),
    },
    external: options.external || DEFAULT_EXTERNALS,
    inject: options.inject || (fs.existsSync(SHARED_POLYFILLS) ? [SHARED_POLYFILLS] : []),
    loader: {
      ...DEFAULT_LOADERS,
      ...(options.loader || {}),
    },
    ...(options.plugins ? { plugins: options.plugins } : {}),
  };
}

async function buildApp(options) {
  const config = createAppConfig(options);
  return esbuild.build(config);
}

async function buildWorker(options) {
  const config = createWorkerConfig(options);
  return esbuild.build(config);
}

async function buildDemoApp(options = {}) {
  const demoName = options.name || 'Demo';
  console.log(`Building ${demoName}...`);

  try {
    // 1. Copy required assets if configured
    if (options.assets && options.assets.length > 0) {
      copyAssets(options.assets);
    }

    if (options.targetDir) {
      if (options.wasm) {
        copyWasmAssets(options.targetDir);
      }
      if (options.tokens) {
        copyTokens(options.targetDir);
      }
    }

    // 2. Build Worker if specified
    if (options.worker) {
      const workerOptions = typeof options.worker === 'object' ? options.worker : {};
      await buildWorker(workerOptions);
    }

    // 3. Build Apps
    const appConfigs = options.apps || (options.app ? [options.app] : []);
    for (const appOpt of appConfigs) {
      await buildApp(appOpt);
    }

    console.log(`✓ ${demoName} built successfully.`);
    return true;
  } catch (err) {
    console.error(`✗ ${demoName} build failed:`, err);
    if (options.exitOnError !== false) {
      process.exit(1);
    }
    throw err;
  }
}

module.exports = {
  ROOT_DIR,
  DEMO_DIR,
  SHARED_DIR,
  SHARED_SRC_DIR,
  SHARED_POLYFILLS,
  SHARED_TOKENS,
  SQL_WASM_SOURCE,
  SQL_WASM_JS_SOURCE,
  DEFAULT_ALIASES,
  DEFAULT_DEFINES,
  DEFAULT_WORKER_DEFINES,
  DEFAULT_EXTERNALS,
  DEFAULT_LOADERS,
  copyAssets,
  copyWasmAssets,
  copyTokens,
  createAppConfig,
  createWorkerConfig,
  buildApp,
  buildWorker,
  buildDemoApp,
};
