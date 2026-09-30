import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToString } from 'react-dom/server';

import {
  DEFAULT_ALIASES,
  DEFAULT_DEFINES,
  DEFAULT_WORKER_DEFINES,
  DEFAULT_EXTERNALS,
  createAppConfig,
  createWorkerConfig,
  copyAssets,
  copyTokens,
  copyWasmAssets,
} from '../demo/build-common.js';

import {
  SyncStatusIndicator,
  QuickStartCard,
  ModalDialog,
  ToastContainer,
  toast,
} from '../demo/shared/src/index';

describe('Shared Demo Infrastructure and UI Suite (Item 13)', () => {
  const rootDir = path.resolve(__dirname, '..');

  describe('Unified Build Pipeline (demo/build-common.js)', () => {
    test('exports standard browser aliases, defines, and loaders', () => {
      expect(DEFAULT_ALIASES).toHaveProperty('crypto', 'crypto-browserify');
      expect(DEFAULT_ALIASES).toHaveProperty('path', 'path-browserify');
      expect(DEFAULT_ALIASES).toHaveProperty('stream', 'stream-browserify');
      expect(DEFAULT_ALIASES).toHaveProperty('buffer', 'buffer');
      expect(DEFAULT_ALIASES).toHaveProperty('util', 'util');
      expect(DEFAULT_ALIASES).toHaveProperty('events', 'events');
      expect(DEFAULT_ALIASES).toHaveProperty('assert', 'assert');
      expect(DEFAULT_ALIASES).toHaveProperty('process', 'process/browser');
      expect(DEFAULT_ALIASES).toHaveProperty('@sovereigns3nc/demo-shared');

      expect(DEFAULT_DEFINES).toEqual({
        'process.env.NODE_ENV': '"development"',
        global: 'window',
        'process.version': '"v18.0.0"',
      });

      expect(DEFAULT_WORKER_DEFINES).toEqual({
        'process.env.NODE_ENV': '"development"',
        global: 'self',
        'process.version': '"v18.0.0"',
      });

      expect(DEFAULT_EXTERNALS).toEqual(expect.arrayContaining(['fs', 'fs-extra', 'path']));
    });

    test('createAppConfig generates valid esbuild options', () => {
      const config = createAppConfig({
        entryPoints: ['demo/social/src/App.tsx'],
        outfile: 'demo/social/bundle.js',
      });

      expect(config.bundle).toBe(true);
      expect(config.platform).toBe('browser');
      expect(config.format).toBe('iife');
      expect(config.define?.['global']).toBe('window');
      expect(config.outfile).toContain('demo/social/bundle.js');
      expect((config.entryPoints as string[])[0]).toContain('demo/social/src/App.tsx');
      expect(config.inject).toBeDefined();
      expect(config.inject?.length).toBeGreaterThan(0);
    });

    test('createWorkerConfig generates valid web worker options', () => {
      const config = createWorkerConfig({
        outfile: 'demo/social/sync-worker.js',
      });

      expect(config.bundle).toBe(true);
      expect(config.platform).toBe('browser');
      expect(config.format).toBe('iife');
      expect(config.define?.['global']).toBe('self');
      expect(config.outfile).toContain('demo/social/sync-worker.js');
      expect((config.entryPoints as string[])[0]).toContain('src/worker/worker.ts');
    });

    test('copyAssets copies existing assets and ignores missing gracefully', () => {
      const tempSrc = path.join(rootDir, 'demo/shared/src/tokens.css');
      const tempDest = path.join(rootDir, 'dist/test-scratch/tokens-copy.css');

      const result = copyAssets([{ from: tempSrc, to: tempDest }]);
      expect(result.length).toBe(1);
      expect(fs.existsSync(tempDest)).toBe(true);

      // Clean up scratch file
      fs.unlinkSync(tempDest);

      // Non-existent source should be ignored safely
      const missingResult = copyAssets([{ from: 'non-existent-source.xyz', to: 'non-existent-dest.xyz' }]);
      expect(missingResult.length).toBe(0);
    });

    test('copyTokens places tokens.css in demo target directory', () => {
      const targetDir = path.join(rootDir, 'dist/test-scratch/demo-target');
      copyTokens(targetDir);
      expect(fs.existsSync(path.join(targetDir, 'tokens.css'))).toBe(true);
      // Clean up
      fs.rmSync(targetDir, { recursive: true, force: true });
    });
  });

  describe('Design Tokens (demo/shared/src/tokens.css)', () => {
    const tokensFile = path.join(rootDir, 'demo/shared/src/tokens.css');

    test('tokens.css exists and defines brand colors and accessible contrasts', () => {
      expect(fs.existsSync(tokensFile)).toBe(true);
      const content = fs.readFileSync(tokensFile, 'utf-8');

      expect(content).toContain('--sov-primary: #1260cc');
      expect(content).toContain('--sov-success: #198754');
      expect(content).toContain('--sov-warning: #996500');
      expect(content).toContain('--sov-danger: #dc3545');
      expect(content).toContain('--sov-bg: #f8f9fa');
      expect(content).toContain('--sov-surface: #ffffff');
      expect(content).toContain('--sov-text: #212529');
    });

    test('tokens.css defines dark theme overrides', () => {
      const content = fs.readFileSync(tokensFile, 'utf-8');
      expect(content).toContain('[data-theme="dark"]');
      expect(content).toContain('--sov-bg: #0d1117');
      expect(content).toContain('--sov-surface: #161b22');
      expect(content).toContain('--sov-primary: #58a6ff');
    });
  });

  describe('Shared UI Components (demo/shared/src/)', () => {
    test('SyncStatusIndicator renders accessible role and status text', () => {
      // 1. Idle / Synced state
      const htmlSynced = renderToString(
        React.createElement(SyncStatusIndicator, {
          syncing: false,
          lastSync: new Date('2026-09-30T10:00:00Z'),
          syncMode: 's3',
        })
      );

      expect(htmlSynced).toContain('role="status"');
      expect(htmlSynced).toContain('aria-live="polite"');
      expect(htmlSynced).toContain('Synced');
      expect(htmlSynced).toContain('s3');

      // 2. Syncing state
      const htmlSyncing = renderToString(
        React.createElement(SyncStatusIndicator, {
          syncing: true,
          syncMode: 'webrtc',
        })
      );
      expect(htmlSyncing).toContain('Syncing...');
      expect(htmlSyncing).toContain('webrtc');

      // 3. Compact mode
      const htmlCompact = renderToString(
        React.createElement(SyncStatusIndicator, {
          syncing: false,
          compact: true,
        })
      );
      expect(htmlCompact).toContain('Synced');
      expect(htmlCompact).not.toContain('s3');
    });

    test('QuickStartCard renders accessible card, bullets, and button', () => {
      const html = renderToString(
        React.createElement(QuickStartCard, {
          title: '⚡ Quick Start (Offline Board)',
          subtitle: 'Instant Kanban Sandbox',
          description: 'Try Kanban boards locally with IndexedDB storage.',
          buttonText: '⚡ Launch Instant Board',
          onLaunch: () => {},
        })
      );

      expect(html).toContain('Quick Start (Offline Board)');
      expect(html).toContain('Instant Kanban Sandbox');
      expect(html).toContain('Try Kanban boards locally with IndexedDB storage.');
      expect(html).toContain('aria-label="⚡ Launch Instant Board"');
      expect(html).toContain('Recommended for First-Time Users');
    });

    test('ModalDialog renders dialog role, aria-labelledby, and header', () => {
      // 1. Closed state renders nothing
      const htmlClosed = renderToString(
        React.createElement(ModalDialog, {
          isOpen: false,
          onClose: () => {},
          children: React.createElement('p', null, 'Hidden Content'),
        })
      );
      expect(htmlClosed).toBe('');

      // 2. Open state renders accessible modal
      const htmlOpen = renderToString(
        React.createElement(
          ModalDialog,
          {
            isOpen: true,
            title: 'Test Dialog Title',
            onClose: () => {},
            footer: React.createElement('button', null, 'Confirm'),
          },
          React.createElement('p', null, 'Dialog Body Content')
        )
      );

      expect(htmlOpen).toContain('role="dialog"');
      expect(htmlOpen).toContain('aria-modal="true"');
      expect(htmlOpen).toContain('aria-labelledby=');
      expect(htmlOpen).toContain('Test Dialog Title');
      expect(htmlOpen).toContain('Dialog Body Content');
      expect(htmlOpen).toContain('aria-label="Close dialog"');
      expect(htmlOpen).toContain('Confirm');
    });

    test('Toast notification manager creates, formats, and clears toasts', () => {
      toast.clear();
      let lastToasts: any[] = [];
      const unsubscribe = toast.subscribe((t) => {
        lastToasts = t;
      });

      // Show info
      const id1 = toast.info('Welcome to SovereignS3nc');
      expect(lastToasts.length).toBe(1);
      expect(lastToasts[0].id).toBe(id1);
      expect(lastToasts[0].type).toBe('info');
      expect(lastToasts[0].message).toBe('Welcome to SovereignS3nc');

      // Show success
      const id2 = toast.success('Profile saved successfully');
      expect(lastToasts.length).toBe(2);
      expect(lastToasts[1].type).toBe('success');

      // Show error
      toast.error('Sync failed');
      expect(lastToasts.length).toBe(3);
      expect(lastToasts[2].type).toBe('error');

      // Dismiss id1
      toast.dismiss(id1);
      expect(lastToasts.length).toBe(2);
      expect(lastToasts.find((t) => t.id === id1)).toBeUndefined();

      // Clear all
      toast.clear();
      expect(lastToasts.length).toBe(0);

      unsubscribe();
    });

    test('ToastContainer renders accessible notification elements', () => {
      const sampleToasts = [
        { id: '1', type: 'success' as const, title: 'Success', message: 'Sync complete' },
        { id: '2', type: 'error' as const, title: 'Error', message: 'Failed to write record' },
      ];

      const html = renderToString(
        React.createElement(ToastContainer, {
          toasts: sampleToasts,
          onDismiss: () => {},
        })
      );

      expect(html).toContain('role="region"');
      expect(html).toContain('aria-label="Notifications"');
      expect(html).toContain('role="status"');
      expect(html).toContain('role="alert"');
      expect(html).toContain('Sync complete');
      expect(html).toContain('Failed to write record');
      expect(html).toContain('aria-label="Dismiss notification"');
    });
  });

  describe('Demo Scripts Integration', () => {
    test('All demo build scripts import build-common.js', () => {
      const demoScripts = [
        'demo/social/build.js',
        'demo/social-local/build.js',
        'demo/banky/build.js',
        'demo/board/build.js',
        'demo/blog/build.js',
        'demo/web/build.js',
      ];

      for (const scriptPath of demoScripts) {
        const fullPath = path.join(rootDir, scriptPath);
        expect(fs.existsSync(fullPath)).toBe(true);
        const content = fs.readFileSync(fullPath, 'utf-8');
        expect(content).toContain("require('../build-common.js')");
      }
    });
  });
});
