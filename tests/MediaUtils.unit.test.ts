import { MediaUtils } from '../src/utils/MediaUtils';
import { Jimp } from 'jimp';

describe('MediaUtils', () => {
    describe('compressImage', () => {
        it('should compress a large image in Node.js environment', async () => {
            // Create a 200x200 image with random noise so PNG is > 50KB while processing in < 1 second
            const image = new (Jimp as any)({ width: 200, height: 200 });
            for (let x = 0; x < 200; x++) {
                for (let y = 0; y < 200; y++) {
                    const randColor = (((x * 37 + y * 97) % 256) * 16777216 + ((x * 13 + y * 67) % 256) * 65536 + ((x * 71 + y * 19) % 256) * 256 + 255) >>> 0;
                    image.setPixelColor(randColor, x, y);
                }
            }
            
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
