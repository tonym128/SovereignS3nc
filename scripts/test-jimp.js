const Jimp = require('jimp');
async function test() {
    try {
        const image = new Jimp(100, 100, 0xFF0000FF); // red 100x100
        const buffer = await image.getBufferAsync(Jimp.MIME_JPEG);
        console.log('Buffer length:', buffer.length);
        console.log('Jimp loaded successfully');
    } catch (err) {
        console.error('Jimp failed:', err);
    }
}
test();
