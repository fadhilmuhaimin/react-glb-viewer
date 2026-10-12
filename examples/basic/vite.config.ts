import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// By default the example imports the package source for instant HMR.
// `USE_DIST=1 bun run build` resolves the built package instead.
const useDist = process.env.USE_DIST === '1';

/**
 * A tiny CORS proxy at /proxy?url=…, standing in for a backend proxy route
 * (like a Next.js API route), so `resolveUrl` can be tried end to end.
 * GET /proxy-log lists the URLs it fetched.
 */
function devProxy(): Plugin {
    const log: string[] = [];
    return {
        name: 'dev-proxy',
        configureServer(server) {
            server.middlewares.use('/proxy-log', (_req, res) => {
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify(log));
            });
            server.middlewares.use('/proxy', async (req, res) => {
                const target = new URL(req.url ?? '', 'http://localhost').searchParams.get('url');
                if (!target) {
                    res.statusCode = 400;
                    res.end('missing url');
                    return;
                }
                log.push(target);
                try {
                    const upstream = await fetch(target);
                    res.statusCode = upstream.status;
                    const type = upstream.headers.get('content-type');
                    if (type) res.setHeader('content-type', type);
                    const body = Buffer.from(await upstream.arrayBuffer());
                    res.setHeader('content-length', String(body.byteLength));
                    res.end(body);
                } catch (error) {
                    res.statusCode = 502;
                    res.end(String(error));
                }
            });
        },
    };
}

export default defineConfig({
    plugins: [react(), devProxy()],
    resolve: {
        // The aliased source sits outside this app; make it share our React and three.
        dedupe: ['react', 'react-dom', 'three'],
        alias: useDist
            ? {}
            : {
                  'react-glb-viewer': fileURLToPath(
                      new URL('../../packages/react-glb-viewer/src/index.ts', import.meta.url)
                  ),
              },
    },
    server: { port: 5175 },
});
