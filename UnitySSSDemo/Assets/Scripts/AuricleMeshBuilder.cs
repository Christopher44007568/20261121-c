using UnityEngine;

namespace SSSDemo
{
    // Procedural stylised auricle: concentric rings in a slightly curved shell.
    // Vertex color.r is the thickness multiplier (thin helix/lobe rim, thicker
    // concha), matching the 0.45-2.4 mm range used by the SSS material.
    public static class AuricleMeshBuilder
    {
        private const int RadialSegments = 28;
        private const int AngularSegments = 96;

        public static Mesh Build(float worldScale)
        {
            var mesh = new Mesh { name = "ProceduralAuricle" };
            int vertexCount = (RadialSegments + 1) * (AngularSegments + 1);
            var vertices = new Vector3[vertexCount];
            var normals = new Vector3[vertexCount];
            var colors = new Color[vertexCount];
            var uvs = new Vector2[vertexCount];

            for (int radial = 0; radial <= RadialSegments; radial++)
            {
                float radius01 = radial / (float)RadialSegments;
                for (int angular = 0; angular <= AngularSegments; angular++)
                {
                    float angle = angular / (float)AngularSegments * Mathf.PI * 2f;
                    int index = radial * (AngularSegments + 1) + angular;

                    // Heart-like lower notch gives the shell an ear silhouette.
                    float notch = 1f + 0.18f * Mathf.Cos(angle) * Mathf.Pow(Mathf.Max(0f, Mathf.Sin(angle * 0.5f)), 3f);
                    float radius = (0.018f + 0.052f * radius01) * notch;
                    float x = Mathf.Cos(angle) * radius * 0.78f;
                    float y = Mathf.Sin(angle) * radius * 1.18f - 0.01f;
                    float z = -0.012f * radius01 * radius01 + 0.004f * Mathf.Sin(angle * 3f) * (1f - radius01);
                    vertices[index] = new Vector3(x, y, z) * worldScale;

                    normals[index] = new Vector3(0.25f * Mathf.Cos(angle), 0.25f * Mathf.Sin(angle), 1f).normalized;

                    // Rim (radius01 near 1) is the thin helix at 0.45-0.9 mm;
                    // the inner concha is thicker, up to 2.4 mm.
                    float rimThin = Mathf.Pow(1f - radius01, 1.6f);
                    float thicknessMultiplier = Mathf.Lerp(2.0f, 0.375f, rimThin);
                    colors[index] = new Color(thicknessMultiplier, 0f, 0f, 1f);
                    uvs[index] = new Vector2(radius01, angular / (float)AngularSegments);
                }
            }

            var triangles = new int[RadialSegments * AngularSegments * 6];
            int triangleIndex = 0;
            for (int radial = 0; radial < RadialSegments; radial++)
            {
                for (int angular = 0; angular < AngularSegments; angular++)
                {
                    int a = radial * (AngularSegments + 1) + angular;
                    int b = a + 1;
                    int c = (radial + 1) * (AngularSegments + 1) + angular;
                    int d = c + 1;
                    triangles[triangleIndex++] = a; triangles[triangleIndex++] = c; triangles[triangleIndex++] = b;
                    triangles[triangleIndex++] = b; triangles[triangleIndex++] = c; triangles[triangleIndex++] = d;
                }
            }

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
