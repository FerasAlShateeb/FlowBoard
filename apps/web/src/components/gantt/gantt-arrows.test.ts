import { describe, expect, it } from 'vitest';

import {
  ARROW_STUB,
  dedupeEdges,
  dependencyPath,
  dependencyPoints,
  edgeKey,
  roundedPolyline,
} from '@/components/gantt/gantt-arrows';

describe('roundedPolyline', () => {
  it('is empty for no points and a bare move for one', () => {
    expect(roundedPolyline([], 4)).toBe('');
    expect(roundedPolyline([{ x: 3, y: 5 }], 4)).toBe('M 3 5');
  });

  it('draws a straight line between two points', () => {
    expect(
      roundedPolyline(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        4,
      ),
    ).toBe('M 0 0 L 10 0');
  });

  it('replaces an interior corner with a quadratic through the vertex', () => {
    const d = roundedPolyline(
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
      ],
      4,
    );
    // Cut back 4px on the way in, curve through (20,0), resume 4px down.
    expect(d).toBe('M 0 0 L 16 0 Q 20 0 20 4 L 20 20');
    // The vertex itself is only ever a control point, never a line target.
    expect(d).not.toContain('L 20 0');
  });

  it('caps the radius at half the shorter neighbouring segment', () => {
    // A 6px jog cannot take a 4px radius on both sides without doubling back.
    const d = roundedPolyline(
      [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
        { x: 6, y: 40 },
      ],
      4,
    );
    expect(d).toBe('M 0 0 L 3 0 Q 6 0 6 3 L 6 40');
  });

  it('drops consecutive duplicate points instead of drawing zero-length arcs', () => {
    const d = roundedPolyline(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      4,
    );
    expect(d).toBe('M 0 0 L 10 0');
  });

  it('rounds coordinates so an unchanged path is an unchanged string', () => {
    const points = [
      { x: 0.1 + 0.2, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(roundedPolyline(points, 4)).toBe('M 0.3 0 L 10 0');
  });
});

describe('dependencyPoints', () => {
  const from = { x: 100, y: 10 };

  it('goes straight across when the two bars share a row with room between', () => {
    expect(dependencyPoints(from, { x: 200, y: 10 })).toEqual([from, { x: 200, y: 10 }]);
  });

  it('uses a single out-across-in elbow for a forward edge on another row', () => {
    const points = dependencyPoints(from, { x: 200, y: 42 });
    expect(points).toEqual([
      { x: 100, y: 10 },
      { x: 110, y: 10 },
      { x: 110, y: 42 },
      { x: 200, y: 42 },
    ]);
    expect(points[1]?.x).toBe(from.x + ARROW_STUB);
  });

  it('detours around a BACKWARDS edge instead of running along the bars', () => {
    // The blocker ends at x=100 but the blocked task starts at x=40 — the real
    // scheduling conflict, and the case worth drawing clearly.
    const points = dependencyPoints(from, { x: 40, y: 42 });
    expect(points).toEqual([
      { x: 100, y: 10 },
      { x: 110, y: 10 },
      { x: 110, y: 26 },
      { x: 30, y: 26 },
      { x: 30, y: 42 },
      { x: 40, y: 42 },
    ]);
    // The crossing lane sits between the two rows, not on either of them.
    expect(points[2]?.y).toBe((10 + 42) / 2);
  });

  it('detours vertically for a backwards edge on the SAME row', () => {
    const points = dependencyPoints(from, { x: 40, y: 10 }, { detour: 14 });
    expect(points).toHaveLength(6);
    expect(points[2]?.y).toBe(24);
    expect(points[3]?.y).toBe(24);
  });

  it('treats a too-tight forward edge as a detour, not as an overlap', () => {
    // Only 5px of room — less than two stubs, so the simple elbow would fold.
    const points = dependencyPoints(from, { x: 105, y: 42 });
    expect(points).toHaveLength(6);
  });
});

describe('dependencyPath', () => {
  it('produces a path that starts at the blocker and ends at the blocked task', () => {
    const d = dependencyPath({ x: 100, y: 10 }, { x: 200, y: 42 });
    expect(d.startsWith('M 100 10')).toBe(true);
    expect(d.endsWith('L 200 42')).toBe(true);
    expect(d).toContain('Q');
  });

  it('is a plain straight segment for a same-row forward edge', () => {
    expect(dependencyPath({ x: 100, y: 10 }, { x: 200, y: 10 })).toBe('M 100 10 L 200 10');
  });

  it('is stable — the same endpoints always produce the same string', () => {
    const a = dependencyPath({ x: 100, y: 10 }, { x: 40, y: 42 });
    const b = dependencyPath({ x: 100, y: 10 }, { x: 40, y: 42 });
    expect(a).toBe(b);
  });
});

describe('edges', () => {
  it('keys an edge by direction', () => {
    expect(edgeKey({ blockerId: 'a', blockedId: 'b' })).toBe('a->b');
    expect(edgeKey({ blockerId: 'b', blockedId: 'a' })).toBe('b->a');
  });

  it('dedupes repeats while keeping both directions and first-seen order', () => {
    expect(
      dedupeEdges([
        { blockerId: 'a', blockedId: 'b' },
        { blockerId: 'a', blockedId: 'b' },
        { blockerId: 'b', blockedId: 'a' },
      ]),
    ).toEqual([
      { blockerId: 'a', blockedId: 'b' },
      { blockerId: 'b', blockedId: 'a' },
    ]);
  });

  it('filters a self-edge, which could only draw a loop over one bar', () => {
    expect(dedupeEdges([{ blockerId: 'a', blockedId: 'a' }])).toEqual([]);
  });
});
