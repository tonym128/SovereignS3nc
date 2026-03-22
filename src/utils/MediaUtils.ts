
export class MediaUtils {
    /**
     * Compresses an image data URL to stay under a target size in bytes.
     * Only works in browser environments where 'document' and 'Image' are available.
     */
    public static async compressImage(dataUrl: string, targetSizeBytes: number): Promise<string> {
        if (typeof document === 'undefined') return dataUrl; 
        
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
