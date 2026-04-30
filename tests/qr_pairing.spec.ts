import { test, expect } from '@playwright/test';

test('QR Code Generation Test', async ({ page }) => {
    page.on('console', msg => console.log('BROWSER:', msg.text()));
    
    // Go to Social Local Demo
    await page.goto('http://127.0.0.1:8886');
    
    // Login
    await page.fill('input[placeholder="User ID"]', 'test-user');
    await page.fill('input[placeholder="Password"]', 'pass123');
    await page.click('button:has-text("Log In")');
    
    // Check for errors on page
    const errorAlert = page.locator('.alert-danger');
    if (await errorAlert.isVisible()) {
        console.log('Login Error Alert:', await errorAlert.innerText());
    }

    await expect(page.locator('nav')).toBeVisible({ timeout: 60000 });

    // Open Pairing Modal
    await page.click('button:has-text("Pair Device")');
    await expect(page.locator('.modal-title')).toContainText('Direct Pairing', { timeout: 10000 });

    // Step 1: Initiator
    await page.click('button:has-text("1. I am the INITIATOR (QR)")');
    
    // Wait for "SCAN ME" step
    await expect(page.locator('h6:has-text("SCAN ME")')).toBeVisible({ timeout: 30000 });

    // Check for canvas
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // Verify canvas is not blank
    // We can evaluate in the browser to check canvas data
    const isCanvasBlank = await canvas.evaluate((canvas: HTMLCanvasElement) => {
        const context = canvas.getContext('2d');
        if (!context) return true;
        
        const pixelData = context.getImageData(0, 0, canvas.width, canvas.height).data;
        // Check if all pixels are same (e.g. all white or all transparent)
        // For a QR code, we expect a mix of black and white.
        let hasContent = false;
        const firstPixel = pixelData.slice(0, 4);
        for (let i = 4; i < pixelData.length; i += 4) {
            if (pixelData[i] !== firstPixel[0] || 
                pixelData[i+1] !== firstPixel[1] || 
                pixelData[i+2] !== firstPixel[2] || 
                pixelData[i+3] !== firstPixel[3]) {
                hasContent = true;
                break;
            }
        }
        return !hasContent;
    });

    expect(isCanvasBlank).toBe(false);
    console.log('QR Code canvas verified: NOT BLANK');
});
