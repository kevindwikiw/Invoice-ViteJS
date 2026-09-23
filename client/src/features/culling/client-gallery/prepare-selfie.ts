export async function prepareSelfie(file: File, signal?: AbortSignal): Promise<File> {
    signal?.throwIfAborted();
    if (file.size > 10 * 1024 * 1024) throw new Error('Please choose an image smaller than 10 MB.');
    const url = URL.createObjectURL(file);
    const image = new Image();
    const abort = () => { image.src = ''; };
    try {
        // Browser image decoding applies EXIF orientation before canvas rasterization.
        image.src = url;
        signal?.addEventListener('abort', abort, { once: true });
        await image.decode();
        signal?.throwIfAborted();
        const { naturalWidth: width, naturalHeight: height } = image;
        if (!width || !height || width * height > 40_000_000) throw new Error('Image dimensions are too large.');
        const scale = Math.min(1, 1280 / Math.max(width, height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Unable to prepare selfie.');
        try {
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Unable to prepare selfie.')), 'image/jpeg', 0.86);
            });
            signal?.throwIfAborted();
            if (blob.size > 4 * 1024 * 1024) throw new Error('Selfie is too large. Please choose a smaller image.');
            return new File([blob], 'selfie.jpg', { type: 'image/jpeg' });
        } finally {
            canvas.width = canvas.height = 0;
        }
    } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof DOMException && error.name === 'EncodingError') {
            throw new Error('This image could not be read. Please choose a JPEG or PNG selfie.');
        }
        throw error;
    } finally {
        signal?.removeEventListener('abort', abort);
        image.src = '';
        URL.revokeObjectURL(url);
    }
}
