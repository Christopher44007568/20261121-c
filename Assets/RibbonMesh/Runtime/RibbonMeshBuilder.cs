using UnityEngine;

namespace RibbonMeshDemo
{
    /// <summary>Per-control-point ribbon appearance and runtime inputs.</summary>
    [System.Serializable]
    public class RibbonSettings
    {
        public Vector3[] ControlPoints = new Vector3[0];
        /// <summary>Full ribbon width per control point.</summary>
        public float[] Widths = new float[0];
        /// <summary>
        /// Fraction of the full width placed on the negative-normal side.
        /// 0.5 is symmetric; other values shift the centerline while the texture
        /// stays anchored to both edges, exposing the geometric asymmetry.
        /// </summary>
        [Range(0.05f, 0.95f)]
        public float[] WidthOffset = new float[0];
        [Min(8)]
        public int RingCount = 220;
        [Min(4)]
        public int DenseSamplesPerSegment = 24;
        /// <summary>Repeats of the texture along one full loop.</summary>
        [Min(0.1f)]
        public float TextureRepeat = 6f;
        /// <summary>When false, the raw transported frames keep their residual twist.</summary>
        public bool CorrectResidualTwist = true;
    }

    public struct CurveSample
    {
        public Vector3 Position;
        public Vector3 Tangent;
        public float T;
        public float ArcLength;
    }

    /// <summary>Turns the closed spline plus settings into a ribbon Mesh.</summary>
    public static class RibbonMeshBuilder
    {
        public class BuildResult
        {
            public Mesh Mesh;
            public Frame[] Frames;
            public float ResidualTwistRadians;
        }

        public static BuildResult Build(RibbonSettings settings)
        {
            int pointCount = settings.ControlPoints == null ? 0 : settings.ControlPoints.Length;
            if (pointCount < 3 || settings.RingCount < 3)
            {
                return null;
            }

            CurveSample[] dense = SampleDense(settings, pointCount);
            CurveSample[] rings = ResampleByArcLength(
                settings.ControlPoints, dense, settings.RingCount);

            // N interior rings plus one closing ring copied from ring 0, so the
            // final mesh quad and texture seam close exactly.
            int total = settings.RingCount + 1;
            var positions = new Vector3[total];
            var tangents = new Vector3[total];
            for (int i = 0; i < settings.RingCount; i++)
            {
                positions[i] = rings[i].Position;
                tangents[i] = rings[i].Tangent;
            }
            positions[settings.RingCount] = rings[0].Position;
            tangents[settings.RingCount] = rings[0].Tangent;

            ParallelTransport.Result transport =
                ParallelTransport.BuildFrames(positions, tangents);

            Mesh mesh = AssembleMesh(settings, transport.Frames, rings);
            mesh.name = "ClosedRibbon";
            mesh.RecalculateBounds();

            return new BuildResult
            {
                Mesh = mesh,
                Frames = transport.Frames,
                ResidualTwistRadians = transport.ResidualTwistRadians,
            };
        }

        private static CurveSample[] SampleDense(RibbonSettings settings, int pointCount)
        {
            int samplesPerSegment = Mathf.Max(4, settings.DenseSamplesPerSegment);
            int total = pointCount * samplesPerSegment;
            var dense = new CurveSample[total + 1];
            float length = 0f;

            for (int i = 0; i < total; i++)
            {
                float t = (float)i / total;
                Vector3 position = ClosedCatmullRomSpline.Evaluate(settings.ControlPoints, t);
                if (i > 0)
                {
                    length += Vector3.Distance(dense[i - 1].Position, position);
                }
                dense[i] = new CurveSample
                {
                    Position = position,
                    T = t,
                    ArcLength = length,
                };
            }

            // Closing sample at t = 1, identical to t = 0 but carrying the arc
            // length of the final wrap-around segment.
            Vector3 closingPosition = ClosedCatmullRomSpline.Evaluate(settings.ControlPoints, 0f);
            length += Vector3.Distance(dense[total - 1].Position, closingPosition);
            dense[total] = new CurveSample
            {
                Position = closingPosition,
                T = 1f,
                ArcLength = length,
            };
            return dense;
        }

        /// <summary>
        /// Inverts the dense arc-length table so rings are spaced evenly in
        /// physical distance, giving uniform texture stretching. Tangents come
        /// from a symmetric central difference on the cyclic dense polyline.
        /// </summary>
        private static CurveSample[] ResampleByArcLength(
            Vector3[] controlPoints, CurveSample[] dense, int ringCount)
        {
            float totalLength = dense[dense.Length - 1].ArcLength;
            int cyclicCount = dense.Length - 1;
            var rings = new CurveSample[ringCount];
            int j = 1;

            for (int ring = 0; ring < ringCount; ring++)
            {
                float targetLength = totalLength * ring / ringCount;
                while (j < dense.Length && dense[j].ArcLength < targetLength)
                {
                    j++;
                }

                CurveSample a = dense[j - 1];
                CurveSample b = dense[j];
                float span = b.ArcLength - a.ArcLength;
                float blend = span <= 1e-10f ? 0f : (targetLength - a.ArcLength) / span;
                float ringT = Mathf.Lerp(a.T, b.T, blend);

                Vector3 back = dense[(j - 1) % cyclicCount].Position;
                Vector3 forward = dense[j % cyclicCount].Position;
                Vector3 tangent = (forward - back).normalized;
                if (tangent.sqrMagnitude < 1e-12f)
                {
                    tangent = ClosedCatmullRomSpline.Tangent(controlPoints, ringT);
                }

                rings[ring] = new CurveSample
                {
                    Position = Vector3.Lerp(a.Position, b.Position, blend),
                    Tangent = tangent,
                    T = ringT,
                    ArcLength = targetLength,
                };
            }
            return rings;
        }

        private static Mesh AssembleMesh(
            RibbonSettings settings, Frame[] frames, CurveSample[] rings)
        {
            int ringCount = frames.Length;
            int interiorCount = rings.Length;
            int vertexCount = ringCount * 2;
            var vertices = new Vector3[vertexCount];
            var normals = new Vector3[vertexCount];
            var uvs = new Vector2[vertexCount];
            var triangles = new int[interiorCount * 6];

            for (int i = 0; i < ringCount; i++)
            {
                // The last frame is the closing ring; reuse ring 0's scalars.
                int scalarIndex = i < interiorCount ? i : 0;
                float t = rings[scalarIndex].T;
                float width = ScalarAt(settings.Widths, t, 1f);
                float offsetFraction = Mathf.Clamp01(
                    ScalarAt(settings.WidthOffset, t, 0.5f));

                Frame frame = frames[i];
                Vector3 across = settings.CorrectResidualTwist ? frame.Normal : frame.RawNormal;
                across = ParallelTransport.Reorthogonalize(frame.Tangent, across);
                Vector3 surfaceNormal = Vector3.Cross(frame.Tangent, across).normalized;

                float negativeExtent = width * offsetFraction;
                float positiveExtent = width * (1f - offsetFraction);

                int minusIndex = i * 2;
                int plusIndex = i * 2 + 1;
                vertices[minusIndex] = frame.Position - across * negativeExtent;
                vertices[plusIndex] = frame.Position + across * positiveExtent;
                normals[minusIndex] = surfaceNormal;
                normals[plusIndex] = surfaceNormal;

                // Across-width UV stays in [0,1] regardless of the geometric
                // offset; the closing ring lands on an integer texture repeat.
                float u = settings.TextureRepeat * i / interiorCount;
                uvs[minusIndex] = new Vector2(u, 0f);
                uvs[plusIndex] = new Vector2(u, 1f);
            }

            for (int i = 0; i < interiorCount; i++)
            {
                int next = i + 1;
                int a = i * 2;
                int b = i * 2 + 1;
                int c = next * 2;
                int d = next * 2 + 1;
                int triangleIndex = i * 6;

                // Winding minus -> plus so the front face follows cross(tangent, across).
                triangles[triangleIndex] = a;
                triangles[triangleIndex + 1] = b;
                triangles[triangleIndex + 2] = c;
                triangles[triangleIndex + 3] = b;
                triangles[triangleIndex + 4] = d;
                triangles[triangleIndex + 5] = c;
            }

            var mesh = new Mesh
            {
                indexFormat = UnityEngine.Rendering.IndexFormat.UInt32
            };
            mesh.vertices = vertices;
            mesh.normals = normals;
            mesh.uv = uvs;
            mesh.triangles = triangles;
            return mesh;
        }

        private static float ScalarAt(float[] values, float t, float fallback)
        {
            if (values == null || values.Length == 0)
            {
                return fallback;
            }
            return ClosedCatmullRomSpline.CyclicScalar(values, t);
        }
    }
}
