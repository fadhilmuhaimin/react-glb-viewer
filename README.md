# react-glb-viewer

A React component for GLB/glTF models built on three.js, with URL
fallbacks and proxying, byte progress, retry, auto-framing and support for
old Sketchfab spec-gloss materials.

```bash
npm install react-glb-viewer three
# or
bun add react-glb-viewer three
```

Usage, props and how it works: [package README](packages/react-glb-viewer/README.md).

## Repository layout

```
packages/react-glb-viewer   the library (tsup, vitest)
examples/basic              Vite + React demo
```

## Develop

```bash
bun install
bun run test        # unit tests
bun run typecheck
bun run build       # packages/react-glb-viewer/dist
bun run dev         # demo on http://localhost:5175
```

The demo imports the library source for hot reload; `USE_DIST=1 bunx vite build`
in `examples/basic` checks the built package instead. It includes a small
`/proxy?url=` middleware (see `vite.config.ts`) to try `resolveUrl`, and
`/proxy-log` lists what went through it.

To try your own file, put it in `examples/basic/public/models/` (gitignored)
and open `http://localhost:5175/?src=/models/your.glb`.

## Releasing

Publishing runs in GitHub Actions ([`publish.yml`](.github/workflows/publish.yml))
with npm [trusted publishing](https://docs.npmjs.com/trusted-publishers): no
npm token is stored anywhere, and npm attaches provenance to each release.

1. Bump `version` in `packages/react-glb-viewer/package.json` and commit.
2. Tag that commit with the same version and push both:

   ```bash
   git tag v0.1.1
   git push origin main v0.1.1
   ```

The workflow refuses to publish if the tag and `package.json` version differ.
Running it manually from the Actions tab does a dry run without publishing.

## License

[MIT](LICENSE)
