// Deterministic fixtures covering the tricky geometric cases.

export const fixtures = {
  // Two squares touching at exactly one vertex (tangent contact).
  tangentSquares: [
    {
      id: "A",
      polygons: [
        { rings: [[[0, 0], [4, 0], [4, 4], [0, 4]]] },
      ],
    },
    {
      id: "B",
      polygons: [
        { rings: [[[4, 4], [8, 4], [8, 8], [4, 8]]] },
      ],
    },
  ],

  // Two squares sharing a full edge.
  sharedEdge: [
    {
      id: "A",
      polygons: [{ rings: [[[0, 0], [4, 0], [4, 4], [0, 4]]] }],
    },
    {
      id: "B",
      polygons: [{ rings: [[[4, 0], [8, 0], [8, 4], [4, 4]]] }],
    },
  ],

  // B sits inside A's hole (nested hole + annular input).
  nestedHole: [
    {
      id: "A",
      polygons: [
        {
          rings: [
            [[0, 0], [10, 0], [10, 10], [0, 10]],
            [[3, 3], [3, 7], [7, 7], [7, 3]],
          ],
        },
      ],
    },
    {
      id: "B",
      polygons: [{ rings: [[[4, 4], [6, 4], [6, 6], [4, 6]]] }],
    },
  ],

  // Overlapping squares with a proper crossing intersection.
  crossingSquares: [
    {
      id: "A",
      polygons: [{ rings: [[[0, 0], [6, 0], [6, 6], [0, 6]]] }],
    },
    {
      id: "B",
      polygons: [{ rings: [[[4, 2], [10, 2], [10, 8], [4, 8]]] }],
    },
  ],

  // Coordinates close to the half-grid rounding boundary (0.49 / 0.51).
  nearThreshold: [
    {
      id: "A",
      polygons: [{ rings: [[[0.49, 0.49], [3.51, 0.49], [3.51, 3.51], [0.49, 3.51]]] }],
    },
    {
      id: "B",
      polygons: [{ rings: [[[2.49, 2.49], [5.51, 2.49], [5.51, 5.51], [2.49, 5.51]]] }],
    },
  ],

  // Edge that collapses to a point after snapping and a sub-triangle ring.
  degenerates: [
    {
      id: "A",
      polygons: [
        { rings: [[[0, 0], [4.1, 0], [4.1, 4], [0.2, 4], [0, 0]].slice(0, 4)] },
      ],
    },
    {
      id: "B",
      polygons: [{ rings: [[[2, 0.2], [6, 0.2], [6, 4], [2, 4]]] }],
    },
  ],

  // Non-trivial polygon with diagonal edges and a hole.
  diagonalHole: [
    {
      id: "A",
      polygons: [
        {
          rings: [
            [[0, 0], [8, 0], [10, 6], [4, 10], [0, 8]],
            [[3, 3], [3, 6], [6, 6], [6, 3]],
          ],
        },
      ],
    },
    {
      id: "B",
      polygons: [{ rings: [[[5, 5], [9, 5], [9, 9], [5, 9]]] }],
    },
  ],
};

export function withScale(fixture, scale) {
  return fixture.map((set) => ({
    id: set.id,
    polygons: set.polygons.map((poly) => ({
      rings: poly.rings.map((ring) => ring.map(([x, y]) => [x * scale, y * scale])),
    })),
  }));
}
