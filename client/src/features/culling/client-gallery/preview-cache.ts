type PreviewImageCacheEntry = {
    image: HTMLImageElement;
    promise: Promise<void>;
    ready: boolean;
};

const PREVIEW_IMAGE_CACHE_LIMIT = 40;
const previewImageCache = new Map<string, PreviewImageCacheEntry>();

function touchPreviewImageCache(url: string, entry: PreviewImageCacheEntry): void {
    previewImageCache.delete(url);
    previewImageCache.set(url, entry);

    while (previewImageCache.size > PREVIEW_IMAGE_CACHE_LIMIT) {
        const oldestUrl = previewImageCache.keys().next().value as string | undefined;
        if (!oldestUrl) break;
        previewImageCache.delete(oldestUrl);
    }
}

export function isPreviewImageReady(url: string): boolean {
    return previewImageCache.get(url)?.ready === true;
}

export function preloadPreviewImage(url: string, priority: 'high' | 'low' = 'low'): Promise<void> {
    const cached = previewImageCache.get(url);
    if (cached) {
        if (priority === 'high') cached.image.fetchPriority = 'high';
        touchPreviewImageCache(url, cached);
        return cached.promise;
    }

    const image = new Image();
    image.decoding = 'async';
    image.fetchPriority = priority;

    const entry: PreviewImageCacheEntry = { image, promise: Promise.resolve(), ready: false };
    entry.promise = new Promise<void>((resolve, reject) => {
        image.onload = () => {
            const finish = () => {
                entry.ready = true;
                touchPreviewImageCache(url, entry);
                resolve();
            };

            if (typeof image.decode === 'function') {
                void image.decode().catch(() => undefined).then(finish);
            } else {
                finish();
            }
        };
        image.onerror = () => {
            previewImageCache.delete(url);
            reject(new Error('Unable to preload gallery preview.'));
        };
    });

    previewImageCache.set(url, entry);
    image.src = url;
    touchPreviewImageCache(url, entry);
    return entry.promise;
}

export function canPrefetchPreview(): boolean {
    const connection = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } }).connection;
    if (connection?.saveData) return false;
    return connection?.effectiveType !== 'slow-2g' && connection?.effectiveType !== '2g';
}

