import { describe, expect, it, vi } from 'vitest';
import { Color, MeshStandardMaterial, SRGBColorSpace, ShaderChunk } from 'three';
import type { GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
import { SpecularGlossinessPlugin, isSpecularGlossiness, readRoughnessFromGlossAlpha } from '../src/specularGlossiness';

// Modelled on a real Sketchfab export whose only material definition is this extension.
const materials = [
    {
        extensions: {
            KHR_materials_pbrSpecularGlossiness: {
                diffuseFactor: [1, 0.5, 0.25, 0.8],
                diffuseTexture: { index: 0 },
                glossinessFactor: 0.9554314832197583,
                specularFactor: [1, 1, 1],
                specularGlossinessTexture: { index: 1 },
            },
        },
        normalTexture: { index: 2 },
    },
    { pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } },
];

function setup() {
    const assignTexture = vi.fn(async (params: Record<string, unknown>, name: string) => {
        params[name] = { isTexture: true, name };
        return null;
    });
    const parser = { json: { materials }, assignTexture } as unknown as GLTFParser;
    return { plugin: new SpecularGlossinessPlugin(parser), assignTexture };
}

describe('SpecularGlossinessPlugin', () => {
    it('claims only spec-gloss materials, as MeshStandardMaterial', () => {
        const { plugin } = setup();
        expect(plugin.name).toBe('KHR_materials_pbrSpecularGlossiness');
        expect(plugin.getMaterialType(0)).toBe(MeshStandardMaterial);
        expect(plugin.getMaterialType(1)).toBeNull();
    });

    it('maps diffuse to base colour and glossiness to roughness, non-metallic', async () => {
        const { plugin, assignTexture } = setup();
        const params: Record<string, unknown> = { metalness: 1, roughness: 1 }; // GLTFLoader defaults
        await plugin.extendMaterialParams(0, params);

        expect((params.color as Color).toArray()).toEqual([1, 0.5, 0.25]);
        expect(params.opacity).toBe(0.8);
        expect(params.metalness).toBe(0);
        expect(params.roughness).toBeCloseTo(1 - 0.9554314832197583, 12);
        expect(assignTexture).toHaveBeenCalledWith(params, 'map', { index: 0 }, SRGBColorSpace);
        expect(assignTexture).toHaveBeenCalledWith(params, 'roughnessMap', { index: 1 });
        expect(params.onBeforeCompile).toBe(readRoughnessFromGlossAlpha);
    });

    it('leaves other materials untouched', async () => {
        const { plugin, assignTexture } = setup();
        const params: Record<string, unknown> = { metalness: 1 };
        await plugin.extendMaterialParams(1, params);
        expect(params).toEqual({ metalness: 1 });
        expect(assignTexture).not.toHaveBeenCalled();
    });

    it('produces a material three accepts without warnings, marked as spec-gloss', async () => {
        const { plugin } = setup();
        const params: Record<string, unknown> = {};
        await plugin.extendMaterialParams(0, params);
        delete params.map; // fake textures from the stub
        delete params.roughnessMap;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const material = new MeshStandardMaterial(params);
        expect(warn).not.toHaveBeenCalled();
        expect(isSpecularGlossiness(material)).toBe(true);
        expect(isSpecularGlossiness(new MeshStandardMaterial())).toBe(false);
        warn.mockRestore();
    });
});

describe('readRoughnessFromGlossAlpha', () => {
    it('replaces the roughness map chunk that three ships', () => {
        // Guards against three renaming the chunk or its varying.
        expect(ShaderChunk.roughnessmap_fragment).toContain('vRoughnessMapUv');
        const shader = { fragmentShader: 'void main() {\n#include <roughnessmap_fragment>\n}' };
        readRoughnessFromGlossAlpha(shader);
        expect(shader.fragmentShader).not.toContain('#include <roughnessmap_fragment>');
        expect(shader.fragmentShader).toContain('texelRoughness.a');
    });
});
