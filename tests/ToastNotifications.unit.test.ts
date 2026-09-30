import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { toast, ToastContainer } from '../demo/shared/src/index';

describe('Toast Notification System & window.alert() Replacement (Item 14)', () => {
  const rootDir = path.resolve(__dirname, '..');

  beforeEach(() => {
    toast.clear();
    jest.useRealTimers();
  });

  afterEach(() => {
    toast.clear();
    jest.useRealTimers();
  });

  describe('Toast Manager API', () => {
    test('supports all severity levels with proper default titles and types', () => {
      let toasts: any[] = [];
      const unsub = toast.subscribe((t) => {
        toasts = t;
      });

      const infoId = toast.info('Information message');
      expect(toasts.length).toBe(1);
      expect(toasts[0].type).toBe('info');
      expect(toasts[0].title).toBe('Info');
      expect(toasts[0].message).toBe('Information message');

      const successId = toast.success('Operation succeeded', 'Custom Success');
      expect(toasts.length).toBe(2);
      expect(toasts[1].type).toBe('success');
      expect(toasts[1].title).toBe('Custom Success');
      expect(toasts[1].message).toBe('Operation succeeded');

      const warnId = toast.warning('Caution needed');
      expect(toasts.length).toBe(3);
      expect(toasts[2].type).toBe('warning');
      expect(toasts[2].title).toBe('Warning');

      const errorId = toast.error('Fatal operation error');
      expect(toasts.length).toBe(4);
      expect(toasts[3].type).toBe('error');
      expect(toasts[3].title).toBe('Error');

      unsub();
    });

    test('auto-dismisses toasts when duration expires', () => {
      jest.useFakeTimers();

      let toasts: any[] = [];
      const unsub = toast.subscribe((t) => {
        toasts = t;
      });

      toast.show({ message: 'Auto-dismiss 1', duration: 1000, type: 'info' });
      toast.show({ message: 'Auto-dismiss 2', duration: 3000, type: 'success' });
      toast.show({ message: 'Sticky notification', duration: 0, type: 'warning' });

      expect(toasts.length).toBe(3);

      // Fast-forward 1000ms
      jest.advanceTimersByTime(1000);
      expect(toasts.length).toBe(2);
      expect(toasts.some((t) => t.message === 'Auto-dismiss 1')).toBe(false);

      // Fast-forward another 2000ms (total 3000ms)
      jest.advanceTimersByTime(2000);
      expect(toasts.length).toBe(1);
      expect(toasts[0].message).toBe('Sticky notification');

      // Sticky notification remains
      jest.advanceTimersByTime(10000);
      expect(toasts.length).toBe(1);

      unsub();
    });

    test('manual dismissal cleans up timers and removes toast immediately', () => {
      jest.useFakeTimers();

      let toasts: any[] = [];
      const unsub = toast.subscribe((t) => {
        toasts = t;
      });

      const id = toast.info('Dismiss early test', 'Dismiss');
      expect(toasts.length).toBe(1);

      toast.dismiss(id);
      expect(toasts.length).toBe(0);

      // Advancing timer does nothing unexpected
      jest.advanceTimersByTime(5000);
      expect(toasts.length).toBe(0);

      unsub();
    });

    test('clear() removes all active toasts and cancels pending timers', () => {
      jest.useFakeTimers();

      let toasts: any[] = [];
      const unsub = toast.subscribe((t) => {
        toasts = t;
      });

      toast.info('Msg 1', undefined);
      toast.success('Msg 2', undefined);
      toast.error('Msg 3', undefined);
      expect(toasts.length).toBe(3);

      toast.clear();
      expect(toasts.length).toBe(0);

      jest.advanceTimersByTime(10000);
      expect(toasts.length).toBe(0);

      unsub();
    });
  });

  describe('ToastContainer Component', () => {
    test('renders nothing when there are no active toasts', () => {
      const html = renderToString(React.createElement(ToastContainer, { toasts: [] }));
      expect(html).toBe('');
    });

    test('renders accessible region and individual toast semantics', () => {
      const active = [
        { id: 't1', type: 'error' as const, title: 'Error Occurred', message: 'Failed to authenticate' },
        { id: 't2', type: 'success' as const, title: 'Success', message: 'Profile saved' },
      ];

      const html = renderToString(React.createElement(ToastContainer, { toasts: active }));

      // Landmark region
      expect(html).toContain('role="region"');
      expect(html).toContain('aria-label="Notifications"');

      // Error toast has role="alert" and aria-live="assertive"
      expect(html).toContain('role="alert"');
      expect(html).toContain('aria-live="assertive"');
      expect(html).toContain('Error Occurred');
      expect(html).toContain('Failed to authenticate');

      // Success toast has role="status" and aria-live="polite"
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('Profile saved');

      // Close button with accessible name
      expect(html).toContain('aria-label="Dismiss notification"');
    });
  });

  describe('Regression: window.alert() Elimination Across All Demos', () => {
    const demoSourceDirs = [
      'demo/social/src',
      'demo/social-local/src',
      'demo/banky/src',
      'demo/board/src',
      'demo/blog/src',
      'demo/web/src',
    ];

    function getAllFiles(dir: string): string[] {
      const results: string[] = [];
      if (!fs.existsSync(dir)) return results;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...getAllFiles(fullPath));
        } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
          results.push(fullPath);
        }
      }
      return results;
    }

    test('no demo source files call native browser alert()', () => {
      const alertRegex = /(?<![.\w])alert\s*\(/g;
      const offendingFiles: { file: string; match: string }[] = [];

      for (const subDir of demoSourceDirs) {
        const fullDir = path.join(rootDir, subDir);
        const files = getAllFiles(fullDir);

        for (const file of files) {
          const content = fs.readFileSync(file, 'utf-8');
          // Exclude comments
          const lines = content.split('\n');
          lines.forEach((line, idx) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
            if (alertRegex.test(line)) {
              offendingFiles.push({ file: `${file}:${idx + 1}`, match: trimmed });
            }
          });
        }
      }

      expect(offendingFiles).toEqual([]);
    });
  });
});
