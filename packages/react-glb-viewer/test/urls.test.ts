import { describe, expect, it } from 'vitest';
import { absolutize, applyResolve, isInlineUrl, resourceBase, toCandidates } from '../src/urls';

const BASE = 'https://site.test/gallery/item/';

describe('toCandidates', () => {
    it('accepts a string or a list, resolves relative URLs and drops blanks', () => {
        expect(toCandidates('/3d/vase.glb', BASE)).toEqual(['https://site.test/3d/vase.glb']);
        expect(toCandidates(['a.glb', '', '  ', 'https://cdn.test/b.glb'], BASE)).toEqual([
            'https://site.test/gallery/item/a.glb',
            'https://cdn.test/b.glb',
        ]);
    });
});

describe('absolutize / isInlineUrl', () => {
    it('leaves data: and blob: URLs untouched', () => {
        expect(isInlineUrl('data:model/gltf+json;base64,AAA')).toBe(true);
        expect(isInlineUrl('blob:https://site.test/1234')).toBe(true);
        expect(absolutize('blob:https://site.test/1234', BASE)).toBe('blob:https://site.test/1234');
    });
});

describe('applyResolve', () => {
    const proxy = (u: string) => `/api/proxy?url=${encodeURIComponent(u)}`;

    it('rewrites remote URLs', () => {
        expect(applyResolve('https://cms.test/a.glb', proxy)).toBe('/api/proxy?url=https%3A%2F%2Fcms.test%2Fa.glb');
    });

    it('never rewrites blob: URLs created for images embedded in a GLB', () => {
        expect(applyResolve('blob:https://site.test/1234', proxy)).toBe('blob:https://site.test/1234');
    });

    it('is a no-op without a resolver', () => {
        expect(applyResolve('https://cms.test/a.glb')).toBe('https://cms.test/a.glb');
    });
});

describe('resourceBase', () => {
    it('is the directory of the logical URL, ignoring query and hash', () => {
        expect(resourceBase('https://cdn.test/models/helmet/scene.gltf?v=2#x')).toBe('https://cdn.test/models/helmet/');
    });

    it('is empty for inline URLs', () => {
        expect(resourceBase('data:model/gltf+json;base64,AAA')).toBe('');
    });
});
