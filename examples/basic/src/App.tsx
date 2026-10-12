import { useRef, useState, type CSSProperties } from 'react';
import { GLBViewer, type GLBViewerHandle, type LoadResult } from 'react-glb-viewer';

const THREE_MODELS = 'https://threejs.org/examples/models/gltf';

interface Sample {
    label: string;
    note: string;
    src: string | string[];
}

const SAMPLES: Sample[] = [
    {
        label: 'Damaged Helmet',
        note: '.gltf with external .bin and textures',
        src: `${THREE_MODELS}/DamagedHelmet/glTF/DamagedHelmet.gltf`,
    },
    {
        label: 'Littlest Tokyo',
        note: 'Draco-compressed GLB with animation',
        src: `${THREE_MODELS}/LittlestTokyo.glb`,
    },
    {
        label: 'Fallback',
        note: 'first URL 404s, second loads',
        src: [`${THREE_MODELS}/does-not-exist.glb`, `${THREE_MODELS}/DamagedHelmet/glTF/DamagedHelmet.gltf`],
    },
    {
        label: 'All fail',
        note: 'error overlay + retry',
        src: [`${THREE_MODELS}/missing-a.glb`, `${THREE_MODELS}/missing-b.glb`],
    },
    {
        label: 'Spec-gloss bottles',
        note: 'left bottle needs spec-gloss support',
        src: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/SpecGlossVsMetalRough/glTF-Binary/SpecGlossVsMetalRough.glb',
    },
];

// ?src=/models/your.glb adds your own model (public/models/ is gitignored).
const customSrc = new URLSearchParams(location.search).get('src');
if (customSrc) SAMPLES.unshift({ label: 'Your model', note: customSrc, src: customSrc });

const BACKGROUNDS = { transparent: null, light: '#f3f4f6', dark: '#111827' } as const;

export function App() {
    const [sample, setSample] = useState(SAMPLES[0]);
    const [viaProxy, setViaProxy] = useState(false);
    const [specGloss, setSpecGloss] = useState(true);
    const [autoRotate, setAutoRotate] = useState(false);
    const [background, setBackground] = useState<keyof typeof BACKGROUNDS>('transparent');
    const [mountKey, setMountKey] = useState(0);
    const [loaded, setLoaded] = useState<LoadResult | null>(null);
    const viewer = useRef<GLBViewerHandle>(null);

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', height: '100vh', font: '14px system-ui' }}>
            <aside style={{ padding: 16, borderRight: '1px solid #e5e7eb', overflow: 'auto' }}>
                <h1 style={{ fontSize: 16, margin: '0 0 12px' }}>react-glb-viewer</h1>
                {SAMPLES.map((s) => (
                    <button
                        key={s.label}
                        onClick={() => setSample(s)}
                        style={{
                            display: 'block',
                            width: '100%',
                            textAlign: 'left',
                            marginBottom: 6,
                            padding: '6px 8px',
                            border: '1px solid #d1d5db',
                            borderRadius: 6,
                            background: s === sample ? '#dbeafe' : 'white',
                            cursor: 'pointer',
                        }}
                    >
                        <b>{s.label}</b>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>{s.note}</div>
                    </button>
                ))}

                <hr style={{ margin: '12px 0', border: 0, borderTop: '1px solid #e5e7eb' }} />
                <label style={{ display: 'block' }}>
                    <input type="checkbox" checked={viaProxy} onChange={(e) => setViaProxy(e.target.checked)} /> Load
                    through /proxy (resolveUrl)
                </label>
                <label style={{ display: 'block' }}>
                    <input
                        type="checkbox"
                        checked={specGloss}
                        onChange={(e) => {
                            setSpecGloss(e.target.checked);
                            setMountKey((k) => k + 1); // a mount-time option
                        }}
                    />{' '}
                    Spec-gloss support
                </label>
                <label style={{ display: 'block' }}>
                    <input type="checkbox" checked={autoRotate} onChange={(e) => setAutoRotate(e.target.checked)} />{' '}
                    Auto-rotate
                </label>
                <label style={{ display: 'block', marginTop: 6 }}>
                    Background{' '}
                    <select value={background} onChange={(e) => setBackground(e.target.value as keyof typeof BACKGROUNDS)}>
                        {Object.keys(BACKGROUNDS).map((k) => (
                            <option key={k}>{k}</option>
                        ))}
                    </select>
                </label>
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button onClick={() => viewer.current?.fit()}>Fit</button>
                    <button onClick={() => setMountKey((k) => k + 1)}>Remount</button>
                </div>

                <pre id="info" style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: '#374151' }}>
                    {loaded
                        ? `loaded: ${loaded.url.split('/').pop()}\nanimations: ${loaded.animations.length}`
                        : '—'}
                </pre>
            </aside>

            <main
                style={{
                    position: 'relative',
                    background: 'radial-gradient(circle at center, #ffffff 0%, #9ca3af 100%)',
                }}
            >
                <GLBViewer
                    key={mountKey}
                    ref={viewer}
                    src={sample.src}
                    resolveUrl={viaProxy ? (url) => `/proxy?url=${encodeURIComponent(url)}` : undefined}
                    specularGlossiness={specGloss}
                    autoRotate={autoRotate}
                    background={BACKGROUNDS[background]}
                    onLoad={setLoaded}
                    onError={() => setLoaded(null)}
                    renderLoading={(p) => (
                        <div style={overlay}>
                            <div style={{ background: 'rgba(0,0,0,.6)', color: 'white', padding: '8px 14px', borderRadius: 8 }}>
                                Loading…{' '}
                                {p?.ratio != null
                                    ? `${Math.round(p.ratio * 100)}%`
                                    : p
                                      ? `${(p.loaded / 1048576).toFixed(1)} MB`
                                      : ''}
                            </div>
                        </div>
                    )}
                    renderError={(error, retry) => (
                        <div style={overlay}>
                            <div style={{ background: 'white', padding: 16, borderRadius: 8, maxWidth: 420 }}>
                                <b style={{ color: '#b91c1c' }}>Could not load the model</b>
                                <ul style={{ fontSize: 12, paddingLeft: 18 }}>
                                    {error.attempts.map((a) => (
                                        <li key={a.url}>
                                            {a.url.split('/').pop()}: {String((a.error as Error)?.message ?? a.error)}
                                        </li>
                                    ))}
                                </ul>
                                <button onClick={retry}>Try again</button>
                            </div>
                        </div>
                    )}
                />
            </main>
        </div>
    );
}

const overlay: CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
};
