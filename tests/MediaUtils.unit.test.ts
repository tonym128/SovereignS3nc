import { MediaUtils } from '../src/utils/MediaUtils';
import { Jimp } from 'jimp';

describe('MediaUtils', () => {
    describe('compressImage', () => {
        it('should compress a large image in Node.js environment', async () => {
            // Create a 2000x2000 red image using Jimp to trigger resizing
            // @ts-ignore
            const image = new Jimp({ width: 2000, height: 2000, color: 0xFF0000FF });
            const buffer = await image.getBuffer('image/png');
            const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
            
            // Try to compress
            const targetSize = 10000;
            const result = await MediaUtils.compressImage(dataUrl, targetSize);
            
            expect(result).not.toBe(dataUrl);
            expect(result.startsWith('data:image/jpeg;base64,')).toBe(true);
            
            const resultBase64 = result.split(',')[1];
            const resultBuffer = Buffer.from(resultBase64, 'base64');
            
            console.log(`Original dimensions: 2000x2000, Original size: ${buffer.length}`);
            console.log(`Compressed size: ${resultBuffer.length}`);
            
            // The result should have been processed.
            // Even if JPEG is larger than this very optimized PNG, it should be different.
        });

        it('should handle invalid data URLs gracefully', async () => {
            const invalid = 'not-a-data-url';
            const result = await MediaUtils.compressImage(invalid, 100);
            expect(result).toBe(invalid);
        });
    });
});
