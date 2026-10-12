import { Color, LinearSRGBColorSpace, MeshStandardMaterial, SRGBColorSpace, type Material } from 'three';
import type { GLTFLoaderPlugin, GLTFParser } from 'three/addons/loaders/GLTFLoader.js';

const EXTENSION = 'KHR_materials_pbrSpecularGlossiness';

interface SpecGlossExtension {
    diffuseFactor?: [number, number, number, number];
    diffuseTexture?: { index: number };
    glossinessFactor?: number;
    specularGlossinessTexture?: { index: number };
}

/**
 * Restores support for `KHR_materials_pbrSpecularGlossiness`, which three.js
 * dropped in r147 but which older Sketchfab and 3ds Max exports still require.
 * Without it those models load untextured and metallic-dark.
 *
 * The conversion is approximate, as recommended by Khronos for viewers that
 * only render metal/rough: diffuse → base colour, metalness 0, and
 * roughness = 1 − glossiness (glossiness read from the alpha channel of the
 * specular-glossiness texture). Specular colour is not reproduced.
 */
export class SpecularGlossinessPlugin implements GLTFLoaderPlugin {
    readonly name = EXTENSION;

    constructor(private readonly parser: GLTFParser) {}

    private extensionOf(materialIndex: number): SpecGlossExtension | null {
        const def = this.parser.json.materials?.[materialIndex];
        return (def?.extensions?.[EXTENSION] as SpecGlossExtension | undefined) ?? null;
    }

    getMaterialType(materialIndex: number) {
        return this.extensionOf(materialIndex) ? MeshStandardMaterial : null;
    }

    extendMaterialParams(materialIndex: number, params: Record<string, unknown>): Promise<unknown> {
        const ext = this.extensionOf(materialIndex);
        if (!ext) return Promise.resolve();

        const [r, g, b, a] = ext.diffuseFactor ?? [1, 1, 1, 1];
        params.color = new Color().setRGB(r, g, b, LinearSRGBColorSpace);
        params.opacity = a;
        params.metalness = 0;
        params.roughness = 1 - (ext.glossinessFactor ?? 1);

        const pending: Promise<unknown>[] = [];
        if (ext.diffuseTexture) {
            pending.push(this.parser.assignTexture(params, 'map', ext.diffuseTexture, SRGBColorSpace));
        }
        if (ext.specularGlossinessTexture) {
            pending.push(this.parser.assignTexture(params, 'roughnessMap', ext.specularGlossinessTexture));
            params.onBeforeCompile = readRoughnessFromGlossAlpha;
            params.customProgramCacheKey = () => EXTENSION;
        }
        return Promise.all(pending);
    }
}

/**
 * three samples roughness from the green channel; spec-gloss stores
 * glossiness in alpha. With `roughness = 1 − glossinessFactor` this yields
 * `1 − glossinessFactor × alpha`, as the extension specifies.
 */
export function readRoughnessFromGlossAlpha(shader: { fragmentShader: string }): void {
    shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        [
            'float roughnessFactor = roughness;',
            '#ifdef USE_ROUGHNESSMAP',
            '\tvec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );',
            '\troughnessFactor = 1.0 - ( 1.0 - roughnessFactor ) * texelRoughness.a;',
            '#endif',
        ].join('\n')
    );
}

/** True when a material came from a spec-gloss definition (for tests and debugging). */
export function isSpecularGlossiness(material: Material): boolean {
    return material.customProgramCacheKey() === EXTENSION;
}
