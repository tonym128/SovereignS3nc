async function test() {
    try {
        const jimpExports = await import('jimp');
        console.log('Jimp exports keys:', Object.keys(jimpExports));
        const Jimp = jimpExports.default || jimpExports;
        console.log('Jimp found:', !!Jimp);
        const image = new Jimp(100, 100, 0xFF0000FF);
        const buffer = await image.getBufferAsync(Jimp.MIME_JPEG);
        console.log('Buffer length:', buffer.length);
    } catch (err) {
        console.error('Dynamic import failed:', err);
    }
}
test();
