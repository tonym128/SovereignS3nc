import { MediaUtils } from '../src/utils/MediaUtils';

describe('MediaUtils', () => {
    describe('compressImage', () => {
        it('should return original data URL in non-browser environments', async () => {
            const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
            const result = await MediaUtils.compressImage(dataUrl, 100);
            expect(result).toBe(dataUrl);
        });

        // More complex tests would require a browser environment (e.g. via jsdom or Playwright)
        // Since this is a unit test in Node, we verify the fallback behavior.
    });
});
