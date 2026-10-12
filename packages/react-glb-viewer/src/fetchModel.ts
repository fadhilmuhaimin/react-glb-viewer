import { applyResolve, type ResolveUrl } from './urls';

export interface LoadProgress {
    /** Bytes received so far. */
    loaded: number;
    /** Total bytes, or `null` when the server does not say (or compresses on the fly). */
    total: number | null;
    /** `loaded / total` in 0–1, or `null` when the total is unknown. */
    ratio: number | null;
    /** The logical model URL being downloaded. */
    url: string;
}

export interface FetchModelOptions {
    resolveUrl?: ResolveUrl;
    requestInit?: RequestInit;
    signal?: AbortSignal;
    onProgress?: (progress: LoadProgress) => void;
    /** Reuse downloaded bytes across viewers. Default `true`. */
    cache?: boolean;
}

export class HttpError extends Error {
    constructor(
        readonly status: number,
        readonly url: string
    ) {
        super(`HTTP ${status} for ${url}`);
        this.name = 'HttpError';
    }
}

const PROGRESS_INTERVAL_MS = 50;

/**
 * Download a model with byte-level progress. Unlike three's LoadingManager,
 * progress is per download (not a page-wide counter), and the request can
 * be aborted when the viewer unmounts or `src` changes.
 */
export async function fetchModel(url: string, options: FetchModelOptions = {}): Promise<ArrayBuffer> {
    const { resolveUrl, requestInit, signal, onProgress, cache = true } = options;
    const fetchUrl = applyResolve(url, resolveUrl);

    if (cache) {
        const hit = modelCache.get(fetchUrl);
        if (hit) {
            onProgress?.({ loaded: hit.byteLength, total: hit.byteLength, ratio: 1, url });
            return hit;
        }
    }

    const response = await fetch(fetchUrl, { ...requestInit, signal });
    if (!response.ok) throw new HttpError(response.status, url);

    // With Content-Encoding the header is the compressed size, but the
    // stream yields decompressed bytes, so a ratio would overshoot.
    const encoding = response.headers.get('content-encoding');
    const length = Number(response.headers.get('content-length'));
    const total = !encoding || encoding === 'identity' ? (length > 0 ? length : null) : null;

    let buffer: ArrayBuffer;
    if (!response.body) {
        buffer = await response.arrayBuffer();
    } else {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let loaded = 0;
        let lastEmit = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.byteLength;
            const now = Date.now();
            if (onProgress && now - lastEmit >= PROGRESS_INTERVAL_MS) {
                lastEmit = now;
                onProgress({ loaded, total, ratio: total ? Math.min(loaded / total, 1) : null, url });
            }
        }
        buffer = concat(chunks, loaded);
    }

    onProgress?.({ loaded: buffer.byteLength, total: buffer.byteLength, ratio: 1, url });
    if (cache) modelCache.set(fetchUrl, buffer);
    return buffer;
}

function concat(chunks: Uint8Array[], length: number): ArrayBuffer {
    const out = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return out.buffer;
}

/**
 * Bytes of recently loaded models, shared by every viewer on the page, so
 * reopening a model (e.g. in a modal) skips the download. Least recently
 * used entries are dropped above `maxBytes`.
 */
export const modelCache = {
    /** Budget for cached model bytes. Default 256 MB. */
    maxBytes: 256 * 1024 * 1024,
    // Sizes are stored separately: a transferred buffer reports byteLength 0.
    entries: new Map<string, { buffer: ArrayBuffer; size: number }>(),
    bytes: 0,

    get(key: string): ArrayBuffer | undefined {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        if (entry.buffer.byteLength === 0) {
            this.delete(key);
            return undefined;
        }
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.buffer;
    },

    set(key: string, buffer: ArrayBuffer): void {
        this.delete(key);
        const size = buffer.byteLength;
        if (size > this.maxBytes) return;
        this.entries.set(key, { buffer, size });
        this.bytes += size;
        for (const [oldest, entry] of this.entries) {
            if (this.bytes <= this.maxBytes) break;
            this.entries.delete(oldest);
            this.bytes -= entry.size;
        }
    },

    delete(key: string): void {
        const entry = this.entries.get(key);
        if (!entry) return;
        this.entries.delete(key);
        this.bytes -= entry.size;
    },

    clear(): void {
        this.entries.clear();
        this.bytes = 0;
    },
};
