using UnityEngine;

namespace RibbonMeshDemo
{
    /// <summary>
    /// Closed centripetal Catmull-Rom spline.
    /// Centripetal parameterization (alpha = 0.5) avoids cusps and overshoot when
    /// neighboring control points are very close or nearly stationary.
    /// The curve wraps cyclically, so the last point connects back to the first.
    /// </summary>
    public static class ClosedCatmullRomSpline
    {
        private const float KnotEpsilon = 1e-8f;

        /// <summary>Evaluates the closed spline at normalized parameter t in [0, 1].</summary>
        public static Vector3 Evaluate(Vector3[] points, float t)
        {
            int count = points.Length;
            float scaled = Mathf.Repeat(t, 1f) * count;
            int segment = Mathf.FloorToInt(scaled) % count;
            float u = scaled - Mathf.Floor(scaled);

            Vector3 p0 = points[(segment - 1 + count) % count];
            Vector3 p1 = points[segment % count];
            Vector3 p2 = points[(segment + 1) % count];
            Vector3 p3 = points[(segment + 2) % count];
            return EvaluateSegment(p0, p1, p2, p3, u);
        }

        /// <summary>
        /// Tangent via central finite differences. Stable when the analytic
        /// derivative degenerates because of nearly coincident control points.
        /// </summary>
        public static Vector3 Tangent(Vector3[] points, float t)
        {
            const float h = 1e-4f;
            float t0 = t - h;
            float t1 = t + h;
            if (t0 < 0f) t0 += 1f;
            if (t1 > 1f) t1 -= 1f;

            Vector3 a = Evaluate(points, t0);
            Vector3 b = Evaluate(points, t1);
            Vector3 derivative = (b - a) / (2f * h);
            if (derivative.sqrMagnitude < 1e-12f)
            {
                int count = points.Length;
                int i = Mathf.Clamp(Mathf.FloorToInt(Mathf.Repeat(t, 1f) * count), 0, count - 1);
                derivative = points[(i + 1) % count] - points[i];
            }
            return derivative.normalized;
        }

        /// <summary>
        /// Linearly interpolates a cyclic scalar channel (width / offset) at
        /// normalized parameter t. Values are associated one-to-one with control points.
        /// </summary>
        public static float CyclicScalar(float[] values, float t)
        {
            int count = values.Length;
            float scaled = Mathf.Repeat(t, 1f) * count;
            int i = Mathf.FloorToInt(scaled);
            float u = scaled - i;
            return Mathf.Lerp(values[i % count], values[(i + 1) % count], u);
        }

        private static Vector3 EvaluateSegment(Vector3 p0, Vector3 p1, Vector3 p2, Vector3 p3, float u)
        {
            float t0 = 0f;
            float t1 = t0 + Mathf.Pow(Mathf.Max(Vector3.Distance(p0, p1), KnotEpsilon), 0.5f);
            float t2 = t1 + Mathf.Pow(Mathf.Max(Vector3.Distance(p1, p2), KnotEpsilon), 0.5f);
            float t3 = t2 + Mathf.Pow(Mathf.Max(Vector3.Distance(p2, p3), KnotEpsilon), 0.5f);
            float t = Mathf.Lerp(t1, t2, u);

            Vector3 a1 = Remap(t0, t1, t, p0, p1);
            Vector3 a2 = Remap(t1, t2, t, p1, p2);
            Vector3 a3 = Remap(t2, t3, t, p2, p3);
            Vector3 b1 = Remap(t0, t2, t, a1, a2);
            Vector3 b2 = Remap(t1, t3, t, a2, a3);
            return Remap(t1, t2, t, b1, b2);
        }

        private static Vector3 Remap(float a, float b, float t, Vector3 va, Vector3 vb)
        {
            if (Mathf.Abs(b - a) < KnotEpsilon)
            {
                return va;
            }
            return va + (vb - va) * ((t - a) / (b - a));
        }
    }
}
