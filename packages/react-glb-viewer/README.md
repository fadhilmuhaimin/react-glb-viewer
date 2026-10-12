# react-glb-viewer

A React component for showing a GLB/glTF model with three.js: orbit
controls, studio lighting and automatic framing, plus the loading
behaviour real apps need.

```tsx
import { GLBViewer } from 'react-glb-viewer';

<GLBViewer src="/models/helmet.glb" style={{ height: 480 }} />;
```

## Why

`useGLTF` from drei and Google's `<model-viewer>` cover the basics. This
component is for models that live on another server, such as a CMS:

- **Fallback URLs.** `src` can be a list. Each URL is tried in order until one
  downloads and parses, e.g. a proxy first and the direct URL second.
- **One place to rewrite URLs.** `resolveUrl` applies to the model *and* to a
  `.gltf` file's external `.bin` and textures, through a per-viewer
  LoadingManager. It never touches three's global `DefaultLoadingManager`,
  and skips the `blob:` URLs three creates for embedded images.
- **Real progress.** Byte-level progress per viewer (`loaded`, `total`,
  `ratio`), including when the server sends no size.
- **Abort and retry.** Changing `src` or unmounting cancels the download;
  `renderError` gets a `retry` function and every URL's error.
- **Fast reopen.** Downloaded bytes are kept in a shared LRU cache (256 MB),
  so reopening a model in a modal skips the network.
- **Old Sketchfab models render correctly.** three.js dropped
  `KHR_materials_pbrSpecularGlossiness` in r147; such models load white and
  untextured. A built-in plugin converts them to standard materials.
- **Cheap when idle.** Frames are drawn only while the camera moves, damping
  settles, auto-rotate is on or an animation plays. The WebGL context is
  released on unmount, so modals can open and close indefinitely.
- **No React Three Fiber needed.** Peer dependencies are just `react` and `three`.

## Install

```bash
npm install react-glb-viewer three
# or
bun add react-glb-viewer three
```

Peer dependencies: `react` ≥ 18, `three` ≥ 0.167. ESM only. The bundle
starts with `'use client'`, so it can be imported from Next.js Server
Components.

## Usage

```tsx
import { GLBViewer } from 'react-glb-viewer';

const proxy = (url: string) => `/api/proxy-3d?url=${encodeURIComponent(url)}`;

export function ModelPanel({ modelUrl }: { modelUrl: string }) {
    return (
        <GLBViewer
            src={[proxy(modelUrl), modelUrl]}
            style={{ height: 480 }}
            renderLoading={(p) => (
                <div className="spinner">{p?.ratio != null ? `${Math.round(p.ratio * 100)}%` : 'Loading…'}</div>
            )}
            renderError={(error, retry) => (
                <div>
                    Could not load the model. <button onClick={retry}>Try again</button>
                </div>
            )}
        />
    );
}
```

The viewer fills its box. Give it a height through `style` or `className`,
or put it inside an element that has one.

To send a `.gltf` file's textures through the proxy as well, use
`resolveUrl` instead of baking the proxy into `src`:

```tsx
<GLBViewer
    src={modelUrl}
    resolveUrl={(url) => (new URL(url).host === 'cms.example.com' ? proxy(url) : url)}
/>
```

## Props

| Prop | Default | |
| --- | --- | --- |
| `src` | — | URL, or URLs tried in order |
| `resolveUrl` | — | `(absoluteUrl) => fetchUrl` for the model and its sub-resources |
| `requestInit` | — | `fetch` options; headers and credentials also apply to sub-resources |
| `renderLoading` | — | `(progress \| null) => ReactNode` overlay while loading |
| `renderError` | — | `(error, retry) => ReactNode` overlay when every URL failed |
| `onProgress` / `onLoad` / `onError` | — | Callbacks. `onLoad` receives `{ url, scene, animations, gltf }` |
| `autoRotate` | `false` | |
| `background` | `null` | CSS colour; `null` keeps the canvas transparent |
| `controls` | `true` | `false`, or `{ enablePan, enableZoom, enableDamping, autoRotateSpeed }` |
| `environment` | `'neutral'` | Studio image-based lighting, or `'none'` |
| `exposure` | `1` | Tone-mapping exposure (Neutral tone mapping) |
| `fov` | `45` | Vertical field of view in degrees |
| `fitPadding` | `1.2` | Space around the framed model |
| `maxPixelRatio` | `2` | Caps devicePixelRatio |
| `animations` | `true` | Play all clips in a loop |
| `cache` | `true` | Use the shared byte cache |
| `specularGlossiness` | `true` | Convert spec-gloss materials |
| `draco` | bundled (three ≥ r185) or Google CDN | `{ decoderPath }` or `false` |
| `ktx2Loader` / `meshoptDecoder` | — | Opt-in decoders, so they are only bundled when used |
| `className`, `style` | — | On the wrapper element |

`src`, `autoRotate`, `background`, `resolveUrl` and the callbacks can change
at any time. The other options are read on mount; change the component's
`key` to apply new ones.

### Ref

```tsx
const ref = useRef<GLBViewerHandle>(null);
<GLBViewer ref={ref} src={url} />;

ref.current?.fit(); // frame the model again
ref.current?.retry(); // load src again
ref.current?.core; // GLBViewerCore: renderer, scene, camera, controls
```

## Without React

`GLBViewerCore` is the framework-agnostic viewer the component wraps:

```ts
import { GLBViewerCore } from 'react-glb-viewer';

const viewer = new GLBViewerCore(document.getElementById('viewer')!, {
    onProgress: (p) => console.log(p.ratio),
});
await viewer.load(['https://a.example/model.glb', 'https://b.example/model.glb']);
// later
viewer.dispose();
```

`fetchModel`, `modelCache` (`maxBytes`, `clear()`) and
`SpecularGlossinessPlugin` (a `GLTFLoader` plugin) are exported too.

## Spec-gloss conversion

The plugin maps diffuse to base colour, sets metalness to 0 and derives
roughness from glossiness (`1 − glossinessFactor × alpha` of the
specular-glossiness texture). Specular colour is not reproduced. For exact
results, convert the files once with
[`gltf-transform metalrough`](https://gltf-transform.dev/cli).

## License

[MIT](LICENSE)
