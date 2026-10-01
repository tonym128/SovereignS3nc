import fs from 'fs';
import path from 'path';
import { applyTheme, getSystemTheme } from '../demo/shared/src/DarkModeToggle';

const classList = new Set<string>();
const attributes = new Map<string, string>();

(global as any).document = {
    documentElement: {
        setAttribute: (k: string, v: string) => attributes.set(k, v),
        getAttribute: (k: string) => attributes.get(k) || null,
        removeAttribute: (k: string) => attributes.delete(k),
        classList: {
            add: (c: string) => classList.add(c),
            remove: (c: string) => classList.delete(c),
            contains: (c: string) => classList.has(c)
        }
    },
    body: {
        classList: {
            add: (c: string) => classList.add(c),
            remove: (c: string) => classList.delete(c),
            contains: (c: string) => classList.has(c)
        }
    }
};
(global as any).window = {
    matchMedia: () => ({ matches: false })
};

describe('Dark Mode Across All Demos (Item 21)', () => {
    const rootDir = path.resolve(__dirname, '..');
    const sharedDir = path.join(rootDir, 'demo/shared/src');

    test('demo/shared exports DarkModeToggle and theme utilities', () => {
        const togglePath = path.join(sharedDir, 'DarkModeToggle.tsx');
        expect(fs.existsSync(togglePath)).toBe(true);

        const indexContent = fs.readFileSync(path.join(sharedDir, 'index.ts'), 'utf8');
        expect(indexContent).toContain('DarkModeToggle');
    });

    test('tokens.css contains comprehensive dark mode custom properties and surface rules', () => {
        const tokensPath = path.join(sharedDir, 'tokens.css');
        expect(fs.existsSync(tokensPath)).toBe(true);

        const content = fs.readFileSync(tokensPath, 'utf8');
        expect(content).toContain('[data-theme="dark"]');
        expect(content).toContain('[data-bs-theme="dark"]');
        expect(content).toContain('--sov-bg: #0d1117');
        expect(content).toContain('--sov-surface: #161b22');
        expect(content).toContain('--sov-text: #c9d1d9');
        expect(content).toContain('--sov-border: #30363d');
        expect(content).toContain('.kanban-column');
        expect(content).toContain('.kanban-task');
    });

    test('applyTheme sets data-theme, data-bs-theme, and dark-theme class on document', () => {
        document.documentElement.className = '';
        document.documentElement.removeAttribute('data-theme');
        document.documentElement.removeAttribute('data-bs-theme');

        applyTheme('dark');
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
        expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
        expect(document.documentElement.classList.contains('dark-theme')).toBe(true);

        applyTheme('light');
        expect(document.documentElement.getAttribute('data-theme')).toBe('light');
        expect(document.documentElement.getAttribute('data-bs-theme')).toBe('light');
        expect(document.documentElement.classList.contains('dark-theme')).toBe(false);
    });

    test('all 5 demo applications integrate DarkModeToggle', () => {
        const demos = [
            'demo/board/src/App.tsx',
            'demo/banky/src/App.tsx',
            'demo/social/src/components/Navigation.tsx',
            'demo/social-local/src/AppLocal.tsx',
            'demo/blog/src/Reader.tsx',
            'demo/blog/src/Editor.tsx'
        ];

        for (const file of demos) {
            const filePath = path.join(rootDir, file);
            expect(fs.existsSync(filePath)).toBe(true);
            const content = fs.readFileSync(filePath, 'utf8');
            expect(content).toContain('DarkModeToggle');
        }
    });

    test('tokens.css is synchronized to all demo directories', () => {
        const demoTokens = [
            'demo/board/tokens.css',
            'demo/banky/tokens.css',
            'demo/social/tokens.css',
            'demo/social-local/tokens.css',
            'demo/blog/tokens.css'
        ];

        for (const file of demoTokens) {
            const filePath = path.join(rootDir, file);
            expect(fs.existsSync(filePath)).toBe(true);
            const content = fs.readFileSync(filePath, 'utf8');
            expect(content).toContain('[data-theme="dark"]');
        }
    });
});
