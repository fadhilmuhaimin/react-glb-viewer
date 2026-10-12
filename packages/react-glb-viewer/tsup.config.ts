import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    // ESM only, like three's addons.
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2020',
    external: ['react', 'react/jsx-runtime', 'three', /^three\//],
    // The component uses hooks and the DOM; mark it client-only for React Server Components.
    banner: { js: "'use client';" },
});
