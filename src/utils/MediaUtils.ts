import { Logger } from './Logger';
import { StorageError } from './Errors';

export class MediaUtils {
    /**
     * Compresses an image data URL to stay under a target size in bytes.
     * Only works in browser environments where 'document' and 'Image' are available.
     */
    static async compressImage(dataUrl: string, targetSizeBytes: number): Promise<string> {
        if (typeof document === 'undefined') {
            // Node.js fallback using Jimp
            try {
                const jimpModule = await import('jimp');
                const Jimp = (jimpModule as any).Jimp || jimpModule.Jimp || jimpModule;
                
                const match = dataUrl.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
                if (!match) {
                    Logger.warn('MediaUtils', 'No regex match for data URL');
                    return dataUrl;
                }
                const buffer = Buffer.from(match[2], 'base64');
                const image = await (Jimp as any).read(buffer);
                
                let quality = 90;
                let resultBuffer = await image.getBuffer('image/jpeg', { quality });
                
                // Iteratively reduce quality or size if needed
                while (resultBuffer.length > targetSizeBytes && (quality > 10 || image.width > 200)) {
                    if (quality > 20) {
                        quality -= 10;
                    } else {
                        const newWidth = Math.floor(image.width * 0.7);
                        const newHeight = Math.floor(image.height * 0.7);
                        image.resize({ w: newWidth, h: newHeight });
                    }
                    resultBuffer = await image.getBuffer('image/jpeg', { quality });
                }
                
                return `data:image/jpeg;base64,${resultBuffer.toString('base64')}`;
            } catch (err: any) {
                Logger.error('MediaUtils', 'Node.js image compression failed:', err.message || JSON.stringify(err));
                return dataUrl;
            }
        }

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.src = dataUrl;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                
                // Initial downscale if very large to save memory
                const maxDim = 1200;
                if (width > maxDim || height > maxDim) {
                    const ratio = Math.min(maxDim / width, maxDim / height);
                    width *= ratio;
                    height *= ratio;
                }
                
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) return reject(new StorageError('Canvas context failed'));
                ctx.drawImage(img, 0, 0, width, height);

                let quality = 0.9;
                let result = dataUrl;
                
                const attempt = () => {
                    result = canvas.toDataURL('image/jpeg', quality);
                    const size = Math.floor((result.length - 81) * 0.75); // approx size in bytes
                    
                    if (size > targetSizeBytes && quality > 0.1) {
                        quality -= 0.1;
                        attempt();
                    } else if (size > targetSizeBytes && width > 100) {
                        // If quality reduction isn't enough, shrink dimensions
                        width *= 0.7;
                        height *= 0.7;
                        canvas.width = width;
                        canvas.height = height;
                        ctx.drawImage(img, 0, 0, width, height);
                        quality = 0.8;
                        attempt();
                    } else { 
                        resolve(result); 
                    }
                };
                attempt();
            };
            img.onerror = (e) => reject(e);
        });
    }
}
