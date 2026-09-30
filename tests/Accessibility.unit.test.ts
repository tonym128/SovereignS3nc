import fs from 'fs';
import path from 'path';

describe('Accessibility Standards and Semantics Unit Suite', () => {
    const rootDir = path.resolve(__dirname, '..');

    test('package.json configures axe-core and test:a11y script', () => {
        const pkgJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
        expect(pkgJson.devDependencies).toHaveProperty('@axe-core/playwright');
        expect(pkgJson.scripts).toHaveProperty('test:a11y');
        expect(pkgJson.scripts['test:a11y']).toContain('playwright');
        expect(pkgJson.scripts['test:a11y']).toContain('playwright.a11y.config.ts');
    });

    test('.github/workflows/ci.yml includes accessibility audit step', () => {
        const ciPath = path.join(rootDir, '.github/workflows/ci.yml');
        expect(fs.existsSync(ciPath)).toBe(true);
        const ciContent = fs.readFileSync(ciPath, 'utf-8');
        expect(ciContent).toContain('npm run test:a11y');
    });

    test('Demo Portal Landing (demo/index.html) satisfies accessibility prerequisites', () => {
        const indexPath = path.join(rootDir, 'demo/index.html');
        expect(fs.existsSync(indexPath)).toBe(true);
        const html = fs.readFileSync(indexPath, 'utf-8');

        // Document landmarks and meta
        expect(html).toContain('<html lang="en">');
        expect(html).toContain('<title>');
        expect(html).toContain('<meta name="description"');
        expect(html).toContain('aria-label="Toggle navigation"');

        // Code editor accessible name
        expect(html).toContain('id="homeCode"');
        expect(html).toContain('aria-label="Executable code snippet"');

        // WCAG AA contrast rules present
        expect(html).toContain('.text-secondary');
        expect(html).toContain('.text-muted');
        expect(html).toContain('.text-success');
    });

    test('Interactive Playground (demo/playground/index.html) contains accessible labels and contrast', () => {
        const playgroundPath = path.join(rootDir, 'demo/playground/index.html');
        expect(fs.existsSync(playgroundPath)).toBe(true);
        const html = fs.readFileSync(playgroundPath, 'utf-8');

        // Editor and interactive buttons have aria labels
        expect(html).toContain('id="codeEditor"');
        expect(html).toContain('aria-label="Code Editor"');
        expect(html).toContain('aria-label="Reset code to recipe default"');
        expect(html).toContain('aria-label="Copy code to clipboard"');
        expect(html).toContain('aria-label="GitHub Repository"');
        expect(html).toContain('#runBtn .btn-shortcut');
    });

    test('Board Kanban (demo/board/src/App.tsx) defines semantic roles and input labels', () => {
        const boardAppPath = path.join(rootDir, 'demo/board/src/App.tsx');
        expect(fs.existsSync(boardAppPath)).toBe(true);
        const code = fs.readFileSync(boardAppPath, 'utf-8');

        // Form labels and IDs
        expect(code).toContain('htmlFor="boardUserId"');
        expect(code).toContain('id="boardUserId"');
        expect(code).toContain('htmlFor="boardPassword"');
        expect(code).toContain('id="boardPassword"');

        // Kanban ARIA landmarks
        expect(code).toContain('role="main"');
        expect(code).toContain('role="region"');
        expect(code).toContain('role="list"');
        expect(code).toContain('role="listitem"');
        expect(code).toContain('aria-label={`Delete task');
    });

    test('Custom Modals implement ARIA dialog pattern (role="dialog", aria-modal="true", aria-labelledby)', () => {
        const dialogFiles = [
            path.join(rootDir, 'demo/social/src/components/Dialog.tsx'),
            path.join(rootDir, 'demo/social/src/PairingModal.tsx'),
            path.join(rootDir, 'demo/social/src/components/InspectorModal.tsx'),
            path.join(rootDir, 'demo/social/src/components/ConflictResolutionModal.tsx'),
            path.join(rootDir, 'demo/social/src/components/MemberManagementModal.tsx')
        ];

        for (const file of dialogFiles) {
            expect(fs.existsSync(file)).toBe(true);
            const content = fs.readFileSync(file, 'utf-8');
            expect(content).toContain('role="dialog"');
            expect(content).toContain('aria-modal="true"');
            expect(content).toContain('aria-labelledby=');
        }
    });

    test('Social components ensure images have alt text and buttons have accessible labels', () => {
        const mediaCode = fs.readFileSync(path.join(rootDir, 'demo/social/src/components/MediaAndUser.tsx'), 'utf-8');
        expect(mediaCode).toContain('alt="Attachment content"');
        expect(mediaCode).toContain('alt={`${p.name || userId} avatar`}');

        const feedCode = fs.readFileSync(path.join(rootDir, 'demo/social/src/components/FeedTab.tsx'), 'utf-8');
        expect(feedCode).toContain('aria-label="What\'s on your mind?"');
        expect(feedCode).toContain('alt="Post attachment preview"');

        const msgCode = fs.readFileSync(path.join(rootDir, 'demo/social/src/components/MessagesTab.tsx'), 'utf-8');
        expect(msgCode).toContain('aria-label="Attach image"');
        expect(msgCode).toContain('aria-label="Type a message"');
    });
});
