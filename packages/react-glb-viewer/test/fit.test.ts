import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW_DIRECTION, fitDistance } from '../src/fit';

const DEG = Math.PI / 180;

/** Half-angle the sphere subtends when seen from `distance`. */
const subtended = (radius: number, distance: number) => Math.asin(radius / distance);

describe('fitDistance', () => {
    it('makes the sphere exactly fill the vertical FOV with padding 1', () => {
        const d = fitDistance(10, 45, 2, 1);
        expect(subtended(10, d)).toBeCloseTo((45 / 2) * DEG, 10);
    });

    it('uses the horizontal FOV in tall (portrait) containers', () => {
        const aspect = 0.5;
        const d = fitDistance(10, 45, aspect, 1);
        const hFov = 2 * Math.atan(Math.tan((45 / 2) * DEG) * aspect);
        expect(subtended(10, d)).toBeCloseTo(hFov / 2, 10);
        expect(d).toBeGreaterThan(fitDistance(10, 45, 2, 1));
    });

    it('scales with padding and radius', () => {
        expect(fitDistance(10, 45, 1, 1.5)).toBeCloseTo(fitDistance(10, 45, 1, 1) * 1.5, 10);
        expect(fitDistance(20, 45, 1, 1)).toBeCloseTo(fitDistance(10, 45, 1, 1) * 2, 10);
    });

    it('never returns 0 for a degenerate (empty) model', () => {
        expect(fitDistance(0, 45, 1)).toBeGreaterThan(0);
    });
});

describe('DEFAULT_VIEW_DIRECTION', () => {
    it('is a unit vector looking from above', () => {
        expect(Math.hypot(...DEFAULT_VIEW_DIRECTION)).toBeCloseTo(1, 12);
        expect(DEFAULT_VIEW_DIRECTION[1]).toBeGreaterThan(0);
    });
});
