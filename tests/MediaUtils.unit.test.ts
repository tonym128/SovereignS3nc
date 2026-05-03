import { MediaUtils } from '../src/utils/MediaUtils';
import { Jimp } from 'jimp';

describe('MediaUtils', () => {
    describe('compressImage', () => {
        it('should compress a large image in Node.js environment', async () => {
            // Start with a small 1x1 red image
            const base64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
            const buffer = Buffer.from(base64.split(',')[1], 'base64');
            
            // Read and scale it up to 2000x2000 to make it "large"
            const image = await (Jimp as any).read(buffer);
            image.resize({ w: 2000, h: 2000 });
            
            const largeBuffer = await image.getBuffer('image/png');
            const dataUrl = `data:image/png;base64,${largeBuffer.toString('base64')}`;
            
            // Try to compress
            const targetSize = 10000;
            const result = await MediaUtils.compressImage(dataUrl, targetSize);
            
            expect(result).not.toBe(dataUrl);
            expect(result.startsWith('data:image/jpeg;base64,')).toBe(true);
            
            const resultBase64 = result.split(',')[1];
            const resultBuffer = Buffer.from(resultBase64, 'base64');
            
            // Should be significantly smaller
            expect(resultBuffer.length).toBeLessThan(largeBuffer.length);
            expect(resultBuffer.length).toBeLessThanOrEqual(targetSize + 2000); // Allow some overhead
        });

        it('should handle invalid data URLs gracefully', async () => {
            const invalid = 'not-a-data-url';
            const result = await MediaUtils.compressImage(invalid, 100);
            expect(result).toBe(invalid);
        });
    });
});
