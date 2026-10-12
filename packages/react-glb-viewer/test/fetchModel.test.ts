import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchModel, HttpError, modelCache, type LoadProgress } from '../src/fetchModel';

/** A Response whose body arrives in `chunks`, like a real download. */
function streamed(chunks: number[], headers: Record<string, string> = {}): Response {
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const size of chunks) controller.enqueue(new Uint8Array(size).fill(7));
            controller.close();
        },
    });
    return new Response(body, { status: 200, headers });
}

describe('fetchModel', () => {
    beforeEach(() => modelCache.clear());
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('returns the bytes and reports progress ending at 100%', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => streamed([1000, 1000, 500], { 'content-length': '2500' })));
        const progress: LoadProgress[] = [];
        const buf = await fetchModel('https://cdn.test/a.glb', { onProgress: (p) => progress.push(p) });

        expect(buf.byteLength).toBe(2500);
        expect(new Uint8Array(buf)[2499]).toBe(7);
        const last = progress.at(-1)!;
        expect(last).toEqual({ loaded: 2500, total: 2500, ratio: 1, url: 'https://cdn.test/a.glb' });
        for (const p of progress) expect(p.ratio === null || p.ratio <= 1).toBe(true);
    });

    it('reports an unknown total when the response is compressed on the fly', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => streamed([4000], { 'content-length': '900', 'content-encoding': 'gzip' }))
        );
        const progress: LoadProgress[] = [];
        // Reach the in-stream report: the first chunk is emitted after the throttle window.
        vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        await fetchModel('https://cdn.test/a.glb', { onProgress: (p) => progress.push(p) });

        expect(progress[0].total).toBeNull();
        expect(progress[0].ratio).toBeNull();
        expect(progress.at(-1)!.ratio).toBe(1);
    });

    it('fetches through resolveUrl', async () => {
        const fetchMock = vi.fn(async () => streamed([10]));
        vi.stubGlobal('fetch', fetchMock);
        await fetchModel('https://cms.test/a.glb', {
            resolveUrl: (u) => `https://site.test/proxy?url=${encodeURIComponent(u)}`,
        });
        expect(fetchMock).toHaveBeenCalledWith(
            'https://site.test/proxy?url=https%3A%2F%2Fcms.test%2Fa.glb',
            expect.anything()
        );
    });

    it('throws HttpError on a non-2xx response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })));
        await expect(fetchModel('https://cms.test/a.glb')).rejects.toBeInstanceOf(HttpError);
    });

    it('serves a second request from the cache', async () => {
        const fetchMock = vi.fn(async () => streamed([64]));
        vi.stubGlobal('fetch', fetchMock);
        await fetchModel('https://cdn.test/a.glb');
        const again = await fetchModel('https://cdn.test/a.glb');
        expect(again.byteLength).toBe(64);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('skips the cache when disabled', async () => {
        const fetchMock = vi.fn(async () => streamed([64]));
        vi.stubGlobal('fetch', fetchMock);
        await fetchModel('https://cdn.test/a.glb', { cache: false });
        await fetchModel('https://cdn.test/a.glb', { cache: false });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('passes the abort signal to fetch', async () => {
        const controller = new AbortController();
        vi.stubGlobal(
            'fetch',
            vi.fn(
                (_url: string, init: RequestInit) =>
                    new Promise<Response>((_, reject) => {
                        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
                    })
            )
        );
        const pending = fetchModel('https://cdn.test/a.glb', { signal: controller.signal });
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    });
});

describe('modelCache', () => {
    beforeEach(() => modelCache.clear());

    it('evicts the least recently used entries above maxBytes', () => {
        const max = modelCache.maxBytes;
        modelCache.maxBytes = 300;
        try {
            modelCache.set('a', new ArrayBuffer(100));
            modelCache.set('b', new ArrayBuffer(100));
            modelCache.get('a'); // a is now more recent than b
            modelCache.set('c', new ArrayBuffer(150));
            expect(modelCache.get('b')).toBeUndefined();
            expect(modelCache.get('a')?.byteLength).toBe(100);
            expect(modelCache.get('c')?.byteLength).toBe(150);
            expect(modelCache.bytes).toBe(250);
        } finally {
            modelCache.maxBytes = max;
        }
    });

    it('drops detached (transferred) buffers and keeps the byte count right', () => {
        const buf = new ArrayBuffer(64);
        modelCache.set('a', buf);
        structuredClone(buf, { transfer: [buf] }); // detaches buf
        expect(modelCache.get('a')).toBeUndefined();
        expect(modelCache.bytes).toBe(0);
    });

    it('does not cache a model larger than the whole budget', () => {
        const max = modelCache.maxBytes;
        modelCache.maxBytes = 10;
        try {
            modelCache.set('big', new ArrayBuffer(11));
            expect(modelCache.get('big')).toBeUndefined();
            expect(modelCache.bytes).toBe(0);
        } finally {
            modelCache.maxBytes = max;
        }
    });
});
