using UnityEngine;

namespace SSSDemo
{
    // Half-plane card for the hard-light-edge measurement. Two cards placed
    // side by side share a zero-gap seam but use material IDs 3 and 4, so the
    // ID gate keeps the seam hard even though diffusion taps cross it on screen.
    public static class EdgeCardBuilder
    {
        public static Mesh Build(int side, float worldScale)
        {
            var mesh = new Mesh { name = side < 0 ? "EdgeCard_Dark_ID3" : "EdgeCard_Lit_ID4" };
            float halfWidth = 0.12f * worldScale;
            float height = 0.16f * worldScale;

            // side -1 covers [-halfWidth, 0], side +1 covers [0, halfWidth].
            float x0 = side < 0 ? -halfWidth : 0f;
            float x1 = side < 0 ? 0f : halfWidth;

            var vertices = new[]
            {
                new Vector3(x0, -height, 0f),
                new Vector3(x1, -height, 0f),
                new Vector3(x1,  height, 0f),
                new Vector3(x0,  height, 0f)
            };
            var normals = new[]
            {
                Vector3.back, Vector3.back, Vector3.back, Vector3.back
            };
            // Green channel is the light mask: 0.12 on the dark card, 0.95 on
            // the lit card, producing an infinitely hard step at the shared seam.
            float lightMask = side < 0 ? 0.12f : 0.95f;
            var colors = new[]
            {
                new Color(1f, lightMask, 0f, 1f),
                new Color(1f, lightMask, 0f, 1f),
                new Color(1f, lightMask, 0f, 1f),
                new Color(1f, lightMask, 0f, 1f)
            };
            var uvs = new[]
            {
                new Vector2(0, 0), new Vector2(1, 0),
                new Vector2(1, 1), new Vector2(0, 1)
            };
            var triangles = side < 0
                ? new[] { 0, 3, 2, 0, 2, 1 }
                : new[] { 0, 1, 2, 0, 2, 3 };

            mesh.vertices = vertices;
            mesh.normals = normals;
            mesh.colors = colors;
            mesh.uv = uvs;
            mesh.triangles = triangles;
            mesh.RecalculateBounds();
            return mesh;
        }
    }
}
