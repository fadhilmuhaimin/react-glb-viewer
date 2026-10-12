const DEG = Math.PI / 180;

/**
 * Camera distance at which a sphere of `radius` fits the view, for a
 * perspective camera with vertical `fovDeg` and `aspect` (width / height).
 * Uses the narrower of the vertical and horizontal field of view, so tall
 * and wide containers both fit. `padding` > 1 leaves a margin.
 */
export function fitDistance(radius: number, fovDeg: number, aspect: number, padding = 1.2): number {
    const vFov = fovDeg * DEG;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const fov = Math.min(vFov, hFov);
    return (Math.max(radius, 1e-6) * padding) / Math.sin(fov / 2);
}

/** Default viewing direction: front-right and a little above, normalised. */
export const DEFAULT_VIEW_DIRECTION: readonly [number, number, number] = normalize([1, 0.6, 1.4]);

function normalize(v: [number, number, number]): [number, number, number] {
    const len = Math.hypot(...v);
    return [v[0] / len, v[1] / len, v[2] / len];
}
