import { test, expect } from '@playwright/test';

test.describe('SovereignS3nc Demo Suite against RustFS', () => {

    test('Banky Demo: Account and Transaction Management with S3 Sync', async ({ page }) => {
        page.on('console', msg => console.log(`[Banky] ${msg.text()}`));
        page.on('response', res => {
            if (res.status() >= 400) console.log(`[Banky HTTP ${res.status()}] ${res.url()}`);
        });

        await page.goto('http://127.0.0.1:8887');
        await expect(page.locator('input[placeholder="e.g. kids-parent"]')).toBeVisible({ timeout: 15000 });

        const testUser = 'banky-user-' + Math.random().toString(36).substring(7);
        await page.fill('input[placeholder="e.g. kids-parent"]', testUser);
        await page.fill('input[placeholder="Master Password"]', 'bankyPass123!');
        await page.click('button:has-text("Login / Register")');

        // Verify logged in
        await expect(page.locator('text=Banky-Sov')).toBeVisible({ timeout: 25000 });
        await expect(page.locator('button:has-text("+ New")')).toBeVisible({ timeout: 20000 });

        // Create new account
        await page.click('button:has-text("+ New")');
        await expect(page.locator('.modal input')).toBeVisible({ timeout: 5000 });
        await page.fill('.modal input', 'Savings Account');
        await page.click('.modal button:has-text("OK")');
        await expect(page.locator('.modal')).toBeHidden({ timeout: 15000 });

        // Wait for account to appear
        const accountItem = page.locator('.list-group-item:has-text("Savings Account")');
        await expect(accountItem).toBeVisible({ timeout: 30000 });
        await accountItem.click();

        // Add a deposit transaction
        await expect(page.locator('button:has-text("Deposit")')).toBeVisible({ timeout: 10000 });
        await page.click('button:has-text("Deposit")');

        // Amount prompt
        await expect(page.locator('.modal input')).toBeVisible({ timeout: 5000 });
        await page.fill('.modal input', '250');
        await page.click('.modal button:has-text("OK")');

        // Description prompt
        await expect(page.locator('.modal input')).toBeVisible({ timeout: 5000 });
        await page.fill('.modal input', 'Initial RustFS Deposit');
        await page.click('.modal button:has-text("OK")');
        await expect(page.locator('.modal')).toBeHidden({ timeout: 15000 });

        // Verify transaction appears and balance updates
        await expect(page.locator('text=Initial RustFS Deposit')).toBeVisible({ timeout: 30000 });
        await expect(page.locator('text=Balance: USD 250.00')).toBeVisible({ timeout: 15000 });

        // Trigger Sync
        await page.click('button:has-text("Sync")');
        await page.waitForTimeout(3000);
    });

    test('Board Demo: Kanban Board and Task Management with S3 Sync', async ({ page }) => {
        page.on('console', msg => console.log(`[Board] ${msg.text()}`));
        page.on('response', res => {
            if (res.status() >= 400) console.log(`[Board HTTP ${res.status()}] ${res.url()}`);
        });

        await page.goto('http://127.0.0.1:8885');
        await expect(page.locator('button:has-text("Join Workspace")')).toBeVisible({ timeout: 15000 });

        // Login
        await page.click('button:has-text("Join Workspace")');

        // Create a board
        const boardInput = page.locator('input[placeholder="Board Name"]');
        await expect(boardInput).toBeVisible({ timeout: 25000 });
        await boardInput.fill('RustFS Kanban');
        await page.click('button:has-text("Create")');

        // Verify board is active
        await expect(page.locator('select option:checked')).toHaveText('RustFS Kanban', { timeout: 15000 });

        // Add a task via browser prompt dialog
        page.once('dialog', dialog => dialog.accept('Test RustFS S3 sync'));
        await page.locator('button:has-text("Add a card")').first().click();

        // Verify task appears
        await expect(page.locator('text=Test RustFS S3 sync')).toBeVisible({ timeout: 15000 });

        // Sync
        await page.click('button:has-text("Sync Now")');
        await page.waitForTimeout(3000);
    });

    test('Blog Demo: Editor Publishing and Reader Consumption via S3', async ({ browser }) => {
        const editorContext = await browser.newContext();
        const readerContext = await browser.newContext();
        const editorPage = await editorContext.newPage();
        const readerPage = await readerContext.newPage();

        editorPage.on('dialog', dialog => dialog.accept());
        editorPage.on('console', msg => console.log(`[Blog Editor] ${msg.text()}`));
        readerPage.on('console', msg => console.log(`[Blog Reader] ${msg.text()}`));

        // 1. Editor login & publish
        await editorPage.goto('http://127.0.0.1:8884/editor.html');
        await expect(editorPage.locator('button:has-text("Enter Editor")')).toBeVisible({ timeout: 15000 });

        // Click Enter Editor (auto-populated by admin_config.json)
        await editorPage.click('button:has-text("Enter Editor")');
        await expect(editorPage.locator('input[placeholder="Post Title"]')).toBeVisible({ timeout: 25000 });

        const postTitle = 'RustFS S3 Blog Post ' + Math.random().toString(36).substring(7);
        await editorPage.fill('input[placeholder="Post Title"]', postTitle);
        await editorPage.fill('textarea[placeholder="Markdown supported..."]', '# Hello from SovereignS3nc!\n\nThis is a blog post stored securely in RustFS S3 object storage.');
        
        // Uncheck Draft checkbox to make it public
        const draftCheckbox = editorPage.locator('input[type="checkbox"]');
        if (await draftCheckbox.isChecked()) {
            await draftCheckbox.uncheck();
        }
        await editorPage.click('button:has-text("Publish")');

        // Verify post appears in published list
        await expect(editorPage.locator(`.list-group-item:has-text("${postTitle}")`)).toBeVisible({ timeout: 25000 });

        // 2. Reader view
        await readerPage.goto('http://127.0.0.1:8884');
        await readerPage.waitForTimeout(3000);

        // Verify the post is displayed in Reader
        await expect(readerPage.locator(`h2:has-text("${postTitle}")`)).toBeVisible({ timeout: 25000 });

        await editorContext.close();
        await readerContext.close();
    });

});
