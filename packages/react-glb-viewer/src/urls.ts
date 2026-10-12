/** Maps a model or sub-resource URL to the URL actually fetched (proxy, signed URL, CDN…). */
export type ResolveUrl = (url: string) => string;

/** Normalise `src` to a list of absolute URLs, tried in order. */
export function toCandidates(src: string | readonly string[], base = defaultBase()): string[] {
    const list = typeof src === 'string' ? [src] : [...src];
    return list.filter((u) => typeof u === 'string' && u.trim() !== '').map((u) => absolutize(u, base));
}

export function absolutize(url: string, base = defaultBase()): string {
    if (isInlineUrl(url)) return url;
    try {
        return new URL(url, base).href;
    } catch {
        return url;
    }
}

/** `data:` and `blob:` URLs are already in memory and must never be rewritten or fetched remotely. */
export function isInlineUrl(url: string): boolean {
    return url.startsWith('data:') || url.startsWith('blob:');
}

/**
 * Apply `resolveUrl` to a URL unless it is inline. glTF loaders create `blob:`
 * URLs for images embedded in GLB files; sending those through a proxy breaks them.
 */
export function applyResolve(url: string, resolveUrl?: ResolveUrl): string {
    if (!resolveUrl || isInlineUrl(url)) return url;
    return resolveUrl(url);
}

/**
 * Directory of a model URL, used to resolve a `.gltf` file's external
 * buffers and textures. Always taken from the *logical* URL, not the proxied
 * one, so `scene.bin` next to `https://cdn/x/scene.gltf` resolves to
 * `https://cdn/x/scene.bin` and then goes through `resolveUrl` itself.
 */
export function resourceBase(url: string): string {
    if (isInlineUrl(url)) return '';
    const clean = url.split(/[?#]/)[0];
    const slash = clean.lastIndexOf('/');
    return slash === -1 ? '' : clean.slice(0, slash + 1);
}

function defaultBase(): string {
    return typeof location !== 'undefined' ? location.href : 'http://localhost/';
}
