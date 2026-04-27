import { Logger } from './Logger';

export class MediaUtils {
    /**
     * Compresses an image data URL to stay under a target size in bytes.
     * Only works in browser environments where 'document' and 'Image' are available.
     */
    public static async compressImage(dataUrl: string, targetSizeBytes: number): Promise<string> {
        if (typeof document === 'undefined') {
            try {
                // Node.js environment fallback using jimp
                const Jimp = (await import('jimp')).default;
                const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
                if (!matches) {
                    Logger.warn('[MediaUtils] No regex match for data URL');
                    return dataUrl;
                }
                
                const buffer = Buffer.from(matches[2], 'base64');
                const image = await Jimp.read(buffer);
                
                let width = image.getWidth();
                let height = image.getHeight();
                const MAX_DIM = 1024;
                let changed = false;
                
                if (width > MAX_DIM || height > MAX_DIM) {
                    if (width > height) {
                        height = (height / width) * MAX_DIM;
                        width = MAX_DIM;
                    } else {
                        width = (width / height) * MAX_DIM;
                        height = MAX_DIM;
                    }
                    image.resize(width, height);
                    changed = true;
                }
                
                let quality = 90;
                let resultBuffer = await image.quality(quality).getBufferAsync(Jimp.MIME_JPEG);
                
                while (resultBuffer.length > targetSizeBytes && quality > 10) {
                    quality -= 10;
                    resultBuffer = await image.quality(quality).getBufferAsync(Jimp.MIME_JPEG);
                    changed = true;
                }

                if (!changed && resultBuffer.length >= buffer.length) {
                    return dataUrl;
                }
                
                return `data:image/jpeg;base64,${resultBuffer.toString('base64')}`;
            } catch (err) {
                Logger.error('[MediaUtils] Node.js image compression failed:', err);
                // Return original on failure
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
                const MAX_DIM = 1024;
                
                if (width > MAX_DIM || height > MAX_DIM) {
                    if (width > height) {
                        height = (height / width) * MAX_DIM;
                        width = MAX_DIM;
                    } else {
                        width = (width / height) * MAX_DIM;
                        height = MAX_DIM;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) return reject(new Error('Canvas context failed'));
                ctx.drawImage(img, 0, 0, width, height);

                let quality = 0.9;
                let result = dataUrl;
                
                const attempt = () => {
                    result = canvas.toDataURL('image/jpeg', quality);
                    const estimatedSize = result.length * 0.75; // Base64 overhead approximation
                    if (estimatedSize > targetSizeBytes && quality > 0.1) {
                        quality -= 0.1;
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
