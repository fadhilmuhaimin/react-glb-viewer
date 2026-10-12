import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
} from 'react';

import type { LoadProgress } from './fetchModel';
import { GLBViewerCore, type GLBViewerOptions, type ModelLoadError, type ViewerStatus } from './GLBViewerCore';

export interface GLBViewerProps extends Omit<GLBViewerOptions, 'onStatusChange'> {
    /** Model URL, or several tried in order until one loads (e.g. `[proxied, direct]`). */
    src: string | readonly string[];
    className?: string;
    /** The viewer fills its box; give it a size here or through `className`. */
    style?: CSSProperties;
    /** Overlay shown while loading. `progress` is `null` until the first bytes arrive. */
    renderLoading?: (progress: LoadProgress | null) => ReactNode;
    /** Overlay shown when every URL failed. */
    renderError?: (error: ModelLoadError, retry: () => void) => ReactNode;
}

export interface GLBViewerHandle {
    /** Load the current `src` again. */
    retry(): void;
    /** Frame the whole model again. */
    fit(): void;
    /** The underlying viewer (renderer, scene, camera, controls). `null` before mount. */
    readonly core: GLBViewerCore | null;
}

interface ViewState {
    status: ViewerStatus;
    progress: LoadProgress | null;
    error: ModelLoadError | null;
}

const fill: CSSProperties = { position: 'absolute', inset: 0 };

/**
 * React component for viewing a GLB/glTF model with orbit controls.
 *
 * ```tsx
 * <GLBViewer
 *   src={[`/api/proxy?url=${encodeURIComponent(url)}`, url]}
 *   style={{ height: 480 }}
 *   renderLoading={(p) => <Spinner percent={p?.ratio} />}
 *   renderError={(e, retry) => <button onClick={retry}>Retry</button>}
 * />
 * ```
 *
 * Renderer options (`environment`, `controls`, `draco`, …) are read once on
 * mount; `src`, `autoRotate`, `background`, `resolveUrl` and the callbacks
 * can change at any time.
 */
export const GLBViewer = forwardRef<GLBViewerHandle, GLBViewerProps>(function GLBViewer(props, ref) {
    const { src, className, style, renderLoading, renderError, autoRotate, background } = props;
    const hostRef = useRef<HTMLDivElement>(null);
    const coreRef = useRef<GLBViewerCore | null>(null);
    const propsRef = useRef(props);
    const [view, setView] = useState<ViewState>({ status: 'idle', progress: null, error: null });

    useEffect(() => {
        propsRef.current = props;
    });

    // Create the viewer once. Callbacks go through propsRef so new handler
    // identities never recreate the WebGL context.
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const core = new GLBViewerCore(host, {
            ...propsRef.current,
            resolveUrl: (url) => propsRef.current.resolveUrl?.(url) ?? url,
            onStatusChange: (status) =>
                setView((v) => ({
                    status,
                    progress: status === 'loading' ? null : v.progress,
                    error: status === 'error' ? core.error : null,
                })),
            onProgress: (progress) => {
                setView((v) => ({ ...v, progress }));
                propsRef.current.onProgress?.(progress);
            },
            onLoad: (result) => propsRef.current.onLoad?.(result),
            onError: (error) => propsRef.current.onError?.(error),
        });
        coreRef.current = core;
        void core.load(propsRef.current.src);
        return () => {
            core.dispose();
            coreRef.current = null;
        };
    }, []);

    // Reload when the URL list changes (compared by value, not array identity).
    const srcKey = typeof src === 'string' ? src : JSON.stringify(src);
    const loadedKey = useRef(srcKey);
    useEffect(() => {
        if (loadedKey.current === srcKey) return;
        loadedKey.current = srcKey;
        void coreRef.current?.load(propsRef.current.src);
    }, [srcKey]);

    useEffect(() => {
        coreRef.current?.setAutoRotate(autoRotate ?? false);
    }, [autoRotate]);

    useEffect(() => {
        coreRef.current?.setBackground(background ?? null);
    }, [background]);

    useImperativeHandle(
        ref,
        () => ({
            retry: () => void coreRef.current?.retry(),
            fit: () => coreRef.current?.fit(),
            get core() {
                return coreRef.current;
            },
        }),
        []
    );

    const retry = () => void coreRef.current?.retry();

    return (
        <div className={className} style={{ position: 'relative', width: '100%', height: '100%', ...style }}>
            <div ref={hostRef} style={fill} />
            {view.status === 'loading' && renderLoading && (
                <div style={{ ...fill, pointerEvents: 'none' }}>{renderLoading(view.progress)}</div>
            )}
            {view.status === 'error' && view.error && renderError && (
                <div style={fill}>{renderError(view.error, retry)}</div>
            )}
        </div>
    );
});
