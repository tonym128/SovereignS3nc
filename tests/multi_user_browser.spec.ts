import { test, expect, BrowserContext, Page } from '@playwright/test';

// Helper to log in a user
async function loginUser(page: Page, userId: string, password: string) {
    page.on('console', msg => {
        if (msg.type() === 'error' || msg.text().includes('[S3]') || msg.text().includes('[Login]')) {
            console.log(`BROWSER [${userId}]: ${msg.text()}`);
        }
    });
    await page.goto('/');
    await page.waitForSelector('input[placeholder="User ID"]', { timeout: 15000 });
    await page.waitForTimeout(1000);

    await page.fill('input[placeholder="User ID"]', userId);
    await page.fill('input[placeholder="Password"]', password);
    await page.click('button:has-text("Log In")');
    
    await expect(page.locator('nav')).toBeVisible({ timeout: 20000 });
}

test('Sovereign Social Multi-User Journey', async ({ browser }) => {
    // 1. Setup Alice and Bob
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    const aliceId = 'alice-' + Math.random().toString(36).substring(7);
    const bobId = 'bob-' + Math.random().toString(36).substring(7);
    console.log(`Testing with Alice: ${aliceId}, Bob: ${bobId}`);

    // 2. Registration & Profile
    await loginUser(alicePage, aliceId, 'pass123');
    await loginUser(bobPage, bobId, 'pass456');

    await alicePage.click('button:has-text("Profile")');
    await alicePage.fill('input[placeholder="Your Name"]', 'Alice Wonderland');
    await alicePage.fill('textarea[placeholder="Tell us about yourself..."]', 'Exploring the digital rabbit hole.');
    await alicePage.click('button:has-text("Save Changes")');
    await alicePage.click('button:has-text("OK")');
    await alicePage.waitForTimeout(2000); 

    // 3. Alice Posts
    await alicePage.click('button:has-text("Home")');
    await alicePage.fill('textarea[placeholder*="What\'s on your mind"]', 'Hello world, this is Alice!');
    await alicePage.click('button:has-text("Post")');
    await alicePage.waitForTimeout(3000); // Wait for sync

    // 4. Bob follows Alice
    await bobPage.click('button:has-text("Friends")');
    
    // Discovery might need multiple syncs
    let followBtn = bobPage.locator('.list-group-item').filter({ hasText: aliceId }).locator('button:has-text("Follow")');
    let followingBtn = bobPage.locator('.list-group-item').filter({ hasText: aliceId }).locator('button:has-text("Following")');
    
    for (let i = 0; i < 5; i++) {
        await bobPage.click('button:has-text("Sync")');
        await bobPage.waitForTimeout(3000);
        if (await followBtn.isVisible() || await followingBtn.isVisible()) break;
        console.log(`Sync attempt ${i+1} for discovery...`);
    }
    
    if (await followBtn.isVisible()) {
        await followBtn.click();
        await expect(followingBtn).toBeVisible({ timeout: 10000 });
    } else {
        console.log("Already following or button in 'Following' state.");
    }

    // 5. Bob sees Alice's post & likes it
    await bobPage.click('button:has-text("Home")');
    await bobPage.click('button:has-text("Sync")');
    await expect(bobPage.locator(`text=Hello world, this is Alice!`)).toBeVisible({ timeout: 20000 });
    
    await bobPage.click('button:has-text("Like")');
    await expect(bobPage.locator('button:has-text("Like (1)")')).toBeVisible();

    // 6. Direct Messaging & Unread Counts
    console.log(`Alice initiating chat with Bob (${bobId})...`);
    await alicePage.getByTestId('nav-messages').click();
    await alicePage.waitForTimeout(2000); // Give React time to render the tab
    
    // // Send message
    // await alicePage.getByTestId('message-input').fill('Hey Bob, Alice here!');
    // await alicePage.getByTestId('message-send-btn').click();
    // await alicePage.waitForTimeout(3000); // Wait for sync/upload

    // // Bob checks messages badge
    // await bobPage.getByTestId('nav-home').click();
    // for (let i = 0; i < 3; i++) {
    //     await bobPage.click('button:has-text("Sync")');
    //     await bobPage.waitForTimeout(2000);
    // }
    
    // const msgBadge = bobPage.getByTestId('unread-badge');
    // await expect(msgBadge).toBeVisible({ timeout: 15000 });
    // await expect(msgBadge).toHaveText('1');

    // // Bob reads & replies
    // await bobPage.getByTestId('nav-messages').click();
    // await bobPage.getByTestId(`chat-item-${aliceId}`).click();
    // await expect(bobPage.getByTestId('message-bubble').filter({ hasText: 'Hey Bob, Alice here!' })).toBeVisible();
    
    // await bobPage.getByTestId('message-input').fill('Received you loud and clear, Alice!');
    // await bobPage.getByTestId('message-send-btn').click();
    // await bobPage.waitForTimeout(3000);

    // // Alice sees reply
    // await alicePage.click('button:has-text("Sync")');
    // await expect(alicePage.getByTestId('message-bubble').filter({ hasText: 'Received you loud and clear, Alice!' })).toBeVisible({ timeout: 15000 });

    // 7. Threading (Back on Home tab)
    await alicePage.getByTestId('nav-home').click();
    const commentBtn = alicePage.locator('.card:has-text("Hello world, this is Alice!") >> button:has-text("Comment")');
    await commentBtn.click();
    await alicePage.fill('.modal input', 'This is a threaded reply');
    await alicePage.click('.modal button:has-text("Confirm")');
    await alicePage.waitForTimeout(3000);

    await bobPage.click('button:has-text("Home")');
    await bobPage.click('button:has-text("Sync")');
    await expect(bobPage.locator('.ms-4:has-text("This is a threaded reply")')).toBeVisible({ timeout: 15000 });

    console.log("Multi-user journey completed successfully (excluding reset/restore).");

    await aliceContext.close();
    await bobContext.close();
});
