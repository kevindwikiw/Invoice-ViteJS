
/**
 * Compresses an image file using the browser's Canvas API.
 * Resizes to stored max dimensions and reduces quality.
 * Returns the original file if it's not an image or if compression fails.
 */
export async function compressImage(
    file: File,
    options: { maxWidth?: number; quality?: number; type?: string } = {}
): Promise<File> {
    const { maxWidth = 1920, quality = 0.8, type = 'image/jpeg' } = options;

    // 1. Validate: Only compress images
    if (!file.type.startsWith('image/')) {
        return file;
    }

    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);

        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;

            img.onload = () => {
                // 2. Calculate new dimensions
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                // 3. Draw to Canvas
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    resolve(file); // Fallback
                    return;
                }

                ctx.drawImage(img, 0, 0, width, height);

                // 4. Export as Blob
                canvas.toBlob(
                    (blob) => {
                        if (!blob) {
                            resolve(file); // Fallback
                            return;
                        }
                        // Create new File from Blob
                        const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", {
                            type: type,
                            lastModified: Date.now(),
                        });

                        // If compressed is larger, return original (rare but possible)
                        if (compressedFile.size > file.size) {
                            resolve(file);
                        } else {
                            resolve(compressedFile);
                        }
                    },
                    type,
                    quality
                );
            };

            img.onerror = () => resolve(file); // Fallback on error
        };

        reader.onerror = () => resolve(file); // Fallback on error
    });
}
