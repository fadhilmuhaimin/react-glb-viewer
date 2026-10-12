import {
    AnimationMixer,
    Box3,
    Color,
    LoadingManager,
    NeutralToneMapping,
    PMREMGenerator,
    PerspectiveCamera,
    REVISION,
    Scene,
    Sphere,
    Vector3,
    WebGLRenderer,
    type AnimationClip,
    type Group,
    type Material,
    type Object3D,
    type Texture,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import type { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

import { fetchModel, type LoadProgress } from './fetchModel';
import { DEFAULT_VIEW_DIRECTION, fitDistance } from './fit';
import { SpecularGlossinessPlugin } from './specularGlossiness';
import { applyResolve, resourceBase, toCandidates, type ResolveUrl } from './urls';

export type ViewerStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface ControlsOptions {
    enablePan?: boolean;
    enableZoom?: boolean;
    /** Smooth camera motion after the pointer is released. Default `true`. */
    enableDamping?: boolean;
    /** Degrees per second at the default speed of 2 ≈ 24°/s. */
    autoRotateSpeed?: number;
}

export interface GLBViewerOptions {
    /**
     * Rewrite every URL before it is fetched: the model and, for `.gltf`
     * files, its external buffers and textures. Use it for a CORS proxy or
     * signed URLs. Receives absolute URLs; `data:`/`blob:` URLs are skipped.
     */
    resolveUrl?: ResolveUrl;
    /** Passed to the model `fetch` (headers, credentials). Headers and credentials also apply to sub-resources. */
    requestInit?: RequestInit;
    /** Keep downloaded bytes in a shared in-memory cache. Default `true`. */
    cache?: boolean;
    /** Draco decoding. `false` disables it. Default: three's bundled decoder (r185+) or Google's CDN. */
    draco?: false | { decoderPath?: string };
    /** A `KTX2Loader` with its transcoder path set; the viewer calls `detectSupport`. */
    ktx2Loader?: KTX2Loader;
    /** `MeshoptDecoder` from `three/addons/libs/meshopt_decoder.module.js`. */
    meshoptDecoder?: typeof MeshoptDecoder;
    /** Load `KHR_materials_pbrSpecularGlossiness` materials (old Sketchfab exports). Default `true`. */
    specularGlossiness?: boolean;
    /** Image-based lighting. `'neutral'` (default) is a soft studio; `'none'` relies on the model's own lights. */
    environment?: 'neutral' | 'none';
    /** Tone-mapping exposure. Default `1`. */
    exposure?: number;
    /** CSS colour, or `null` (default) for a transparent canvas over your own background. */
    background?: string | null;
    /** Orbit controls. `false` disables interaction. Default `true`. */
    controls?: boolean | ControlsOptions;
    autoRotate?: boolean;
    /** Vertical field of view in degrees. Default `45`. */
    fov?: number;
    /** Space around the model when framing it; 1 = touching the edges. Default `1.2`. */
    fitPadding?: number;
    /** Cap on devicePixelRatio, to keep phones fast. Default `2`. */
    maxPixelRatio?: number;
    /** Play the model's animations in a loop. Default `true`. */
    animations?: boolean;
    onStatusChange?: (status: ViewerStatus) => void;
    onProgress?: (progress: LoadProgress) => void;
    onLoad?: (result: LoadResult) => void;
    onError?: (error: ModelLoadError) => void;
}

export interface LoadResult {
    /** The candidate URL that loaded. */
    url: string;
    scene: Group;
    animations: AnimationClip[];
    gltf: GLTF;
}

/** Every candidate URL failed. `attempts` lists each URL with its error. */
export class ModelLoadError extends Error {
    constructor(readonly attempts: { url: string; error: unknown }[]) {
        super(
            attempts.length === 0
                ? 'No model URL given'
                : `Could not load model: ${attempts.map((a) => `${a.url} (${messageOf(a.error)})`).join('; ')}`
        );
        this.name = 'ModelLoadError';
    }
}

const DEFAULT_DRACO_DECODER_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.6/';

/**
 * Framework-agnostic GLB/glTF viewer: renderer, camera, orbit controls,
 * studio lighting and loading with fallbacks. `<GLBViewer>` wraps it for React.
 *
 * Renders on demand: frames are drawn while the camera moves, damping
 * settles, auto-rotate is on or an animation plays, and not otherwise.
 */
export class GLBViewerCore {
    readonly renderer: WebGLRenderer;
    readonly scene = new Scene();
    readonly camera: PerspectiveCamera;
    readonly controls: OrbitControls | null = null;

    status: ViewerStatus = 'idle';
    progress: LoadProgress | null = null;
    error: ModelLoadError | null = null;

    private model: Object3D | null = null;
    private mixer: AnimationMixer | null = null;
    private envTarget: { texture: Texture; dispose(): void } | null = null;
    private draco: DRACOLoader | null = null;
    private abort: AbortController | null = null;
    private lastSrc: string | readonly string[] | null = null;
    private resizeObserver: ResizeObserver;
    private frame = 0;
    private lastFrameAt = 0;
    private fitPending = false;
    private disposed = false;

    constructor(
        private readonly container: HTMLElement,
        private readonly options: GLBViewerOptions = {}
    ) {
        const renderer = new WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, options.maxPixelRatio ?? 2));
        renderer.toneMapping = NeutralToneMapping;
        renderer.toneMappingExposure = options.exposure ?? 1;
        Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%' });
        container.appendChild(renderer.domElement);
        this.renderer = renderer;

        this.setBackground(options.background ?? null);
        if (options.environment !== 'none') {
            const pmrem = new PMREMGenerator(renderer);
            const room = new RoomEnvironment();
            this.envTarget = pmrem.fromScene(room, 0.04);
            this.scene.environment = this.envTarget.texture;
            room.dispose();
            pmrem.dispose();
        }

        this.camera = new PerspectiveCamera(options.fov ?? 45, 1, 0.01, 1000);
        this.camera.position.set(0, 0, 5);

        if (options.controls !== false) {
            const c = typeof options.controls === 'object' ? options.controls : {};
            const controls = new OrbitControls(this.camera, renderer.domElement);
            controls.enableDamping = c.enableDamping ?? true;
            controls.enablePan = c.enablePan ?? true;
            controls.enableZoom = c.enableZoom ?? true;
            controls.autoRotateSpeed = c.autoRotateSpeed ?? 2;
            controls.autoRotate = options.autoRotate ?? false;
            controls.addEventListener('change', () => this.requestRender());
            this.controls = controls;
        }

        if (options.draco !== false) this.draco = acquireDraco(options.draco?.decoderPath);
        options.ktx2Loader?.detectSupport(renderer);

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(container);
        this.resize();
    }

    // ── Loading ──────────────────────────────────────────────────────────────

    /**
     * Load a model, trying each URL in order until one downloads and parses.
     * A newer `load()` call or `dispose()` cancels this one; it then resolves
     * to `null`. Failures are reported through `onError` and resolve to `null`.
     */
    async load(src: string | readonly string[]): Promise<LoadResult | null> {
        this.abort?.abort();
        const abort = new AbortController();
        this.abort = abort;
        this.lastSrc = src;
        this.error = null;
        this.progress = null;
        this.setStatus('loading');

        const attempts: { url: string; error: unknown }[] = [];
        for (const url of toCandidates(src)) {
            try {
                const buffer = await fetchModel(url, {
                    resolveUrl: this.options.resolveUrl,
                    requestInit: this.options.requestInit,
                    cache: this.options.cache,
                    signal: abort.signal,
                    onProgress: (progress) => {
                        if (abort.signal.aborted) return;
                        this.progress = progress;
                        this.options.onProgress?.(progress);
                    },
                });
                if (abort.signal.aborted) return null;

                const gltf = await this.parse(buffer, url);
                if (abort.signal.aborted) {
                    disposeObject(gltf.scene);
                    return null;
                }

                this.setModel(gltf);
                const result: LoadResult = { url, scene: gltf.scene, animations: gltf.animations, gltf };
                this.setStatus('loaded');
                this.options.onLoad?.(result);
                return result;
            } catch (error) {
                if (abort.signal.aborted) return null;
                attempts.push({ url, error });
            }
        }

        // The previous model stays up while a new one loads, but not behind
        // an error for a different model.
        this.clearModel();
        this.requestRender();
        this.error = new ModelLoadError(attempts);
        this.setStatus('error');
        this.options.onError?.(this.error);
        return null;
    }

    /** Load the last `src` again, e.g. from an error overlay's retry button. */
    retry(): Promise<LoadResult | null> {
        return this.lastSrc ? this.load(this.lastSrc) : Promise.resolve(null);
    }

    private parse(buffer: ArrayBuffer, url: string): Promise<GLTF> {
        const { resolveUrl, requestInit, ktx2Loader, meshoptDecoder } = this.options;

        // A LoadingManager per load, never three's DefaultLoadingManager, so
        // URL rewriting cannot leak into other viewers or other three code.
        const manager = new LoadingManager();
        manager.setURLModifier((u) => applyResolve(u, resolveUrl));
        const loader = new GLTFLoader(manager);

        if (requestInit?.headers) loader.setRequestHeader(headersToRecord(requestInit.headers));
        if (requestInit?.credentials === 'include') loader.setWithCredentials(true);
        if (this.draco) loader.setDRACOLoader(this.draco);
        if (ktx2Loader) loader.setKTX2Loader(ktx2Loader);
        if (meshoptDecoder) loader.setMeshoptDecoder(meshoptDecoder);
        if (this.options.specularGlossiness !== false) {
            loader.register((parser) => new SpecularGlossinessPlugin(parser));
        }

        return loader.parseAsync(buffer, resourceBase(url));
    }

    private setModel(gltf: GLTF): void {
        this.clearModel();
        this.model = gltf.scene;
        this.scene.add(gltf.scene);

        if (this.options.animations !== false && gltf.animations.length > 0) {
            this.mixer = new AnimationMixer(gltf.scene);
            for (const clip of gltf.animations) this.mixer.clipAction(clip).play();
        }
        this.fit();
    }

    private clearModel(): void {
        this.mixer?.stopAllAction();
        this.mixer = null;
        if (this.model) {
            this.scene.remove(this.model);
            disposeObject(this.model);
            this.model = null;
        }
    }

    // ── Camera ───────────────────────────────────────────────────────────────

    /** Frame the whole model from the default angle. */
    fit(): void {
        if (!this.model) return;
        const { clientWidth, clientHeight } = this.container;
        if (!clientWidth || !clientHeight) {
            this.fitPending = true; // container not laid out yet; fit on first resize
            return;
        }
        this.fitPending = false;

        const box = new Box3().setFromObject(this.model);
        if (box.isEmpty()) return;
        const { center, radius } = box.getBoundingSphere(new Sphere());
        const camera = this.camera;
        const distance = fitDistance(radius, camera.fov, camera.aspect, this.options.fitPadding ?? 1.2);

        camera.position.copy(center).addScaledVector(new Vector3(...DEFAULT_VIEW_DIRECTION), distance);
        camera.near = Math.max(radius * 0.001, 1e-4);
        camera.far = distance * 20 + radius * 2;
        camera.updateProjectionMatrix();
        camera.lookAt(center);

        if (this.controls) {
            this.controls.target.copy(center);
            this.controls.minDistance = radius * 0.05;
            this.controls.maxDistance = distance * 10;
            this.controls.update();
        }
        this.requestRender();
    }

    setAutoRotate(on: boolean): void {
        if (!this.controls) return;
        this.controls.autoRotate = on;
        this.requestRender();
    }

    /** CSS colour, or `null` for a transparent canvas. */
    setBackground(color: string | null): void {
        this.scene.background = color ? new Color(color) : null;
        this.requestRender();
    }

    // ── Rendering ────────────────────────────────────────────────────────────

    requestRender(): void {
        if (this.frame || this.disposed) return;
        this.frame = requestAnimationFrame(this.tick);
    }

    private tick = (now: number): void => {
        this.frame = 0;
        // Clamp so a long idle gap doesn't make animations jump.
        const dt = this.lastFrameAt ? Math.min((now - this.lastFrameAt) / 1000, 0.1) : 0;
        this.lastFrameAt = now;

        let keepGoing = false;
        if (this.controls) {
            // update() returns true while damping or auto-rotate still move the camera.
            keepGoing = this.controls.update(dt) || this.controls.autoRotate;
        }
        if (this.mixer) {
            this.mixer.update(dt);
            keepGoing = true;
        }
        this.renderer.render(this.scene, this.camera);
        if (keepGoing) this.requestRender();
        else this.lastFrameAt = 0;
    };

    private resize(): void {
        const { clientWidth: width, clientHeight: height } = this.container;
        if (!width || !height) return;
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        if (this.fitPending) this.fit();
        this.requestRender();
    }

    private setStatus(status: ViewerStatus): void {
        this.status = status;
        this.options.onStatusChange?.(status);
    }

    /** Stop loading, free GPU memory and the WebGL context, and remove the canvas. */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.abort?.abort();
        cancelAnimationFrame(this.frame);
        this.resizeObserver.disconnect();
        this.controls?.dispose();
        this.clearModel();
        this.envTarget?.dispose();
        if (this.draco) releaseDraco(this.draco);
        this.renderer.dispose();
        // Browsers cap live WebGL contexts (~16); release ours now rather than
        // at garbage collection, so a modal can be reopened many times.
        this.renderer.forceContextLoss();
        this.renderer.domElement.remove();
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function disposeObject(root: Object3D): void {
    root.traverse((obj) => {
        const mesh = obj as Object3D & { geometry?: { dispose(): void }; material?: Material | Material[] };
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        for (const material of materials) {
            for (const value of Object.values(material)) {
                if ((value as Texture | null)?.isTexture) (value as Texture).dispose();
            }
            material.dispose();
        }
    });
}

function headersToRecord(headers: HeadersInit): Record<string, string> {
    return Object.fromEntries(new Headers(headers).entries());
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// DRACOLoader spins up Web Workers, so viewers on the same page share one per decoder path.
const dracoLoaders = new Map<string, { loader: DRACOLoader; users: number }>();

function acquireDraco(decoderPath?: string): DRACOLoader {
    // three r185+ ships a decoder next to DRACOLoader and uses it by default.
    const path = decoderPath ?? (Number.parseInt(REVISION, 10) >= 185 ? '' : DEFAULT_DRACO_DECODER_PATH);
    let entry = dracoLoaders.get(path);
    if (!entry) {
        const loader = new DRACOLoader();
        if (path) loader.setDecoderPath(path);
        entry = { loader, users: 0 };
        dracoLoaders.set(path, entry);
    }
    entry.users++;
    return entry.loader;
}

function releaseDraco(loader: DRACOLoader): void {
    for (const [path, entry] of dracoLoaders) {
        if (entry.loader !== loader) continue;
        if (--entry.users === 0) {
            loader.dispose();
            dracoLoaders.delete(path);
        }
        return;
    }
}
