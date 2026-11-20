using UnityEngine;

namespace RibbonMeshDemo
{
    /// <summary>
    /// One orthonormal ribbon frame. The normal is the ribbon's across-width axis;
    /// binormal is the surface normal. All frames form a continuous moving frame
    /// along the closed curve.
    /// </summary>
    public struct Frame
    {
        public Vector3 Position;
        public Vector3 Tangent;
        public Vector3 Normal;
        public Vector3 Binormal;
        /// <summary>Frame normal before the closed-loop residual twist correction.</summary>
        public Vector3 RawNormal;
    }

    /// <summary>
    /// Parallel-transport frames for a sampled closed curve.
    /// Unlike Frenet frames, transported frames do not flip at inflection points
    /// where the curve's curvature passes through zero.
    /// </summary>
    public static class ParallelTransport
    {
        public struct Result
        {
            public Frame[] Frames;
            /// <summary>Signed residual twist (radians) left after one full loop, pre-correction.</summary>
            public float ResidualTwistRadians;
        }

        /// <summary>
        /// Builds parallel-transport frames along cyclic samples. The input arrays
        /// contain N interior rings followed by a closing ring that is identical to
        /// ring 0 (same position and tangent), giving transport a well-defined final
        /// step. The measured closing residual twist is then distributed uniformly,
        /// so the closing ring matches ring 0 exactly and the texture seam stays
        /// continuous.
        /// </summary>
        public static Result BuildFrames(Vector3[] positions, Vector3[] tangents)
        {
            int total = positions.Length;
            int interiorCount = total - 1;
            Frame[] frames = new Frame[total];
            Vector3[] rawNormals = new Vector3[total];

            Vector3 tangent0 = tangents[0].normalized;
            Vector3 normal0 = Perpendicular(tangent0);
            rawNormals[0] = normal0;

            for (int i = 1; i < total; i++)
            {
                Vector3 previousTangent = tangents[i - 1].normalized;
                Vector3 currentTangent = tangents[i].normalized;

                // FromToRotation gives the minimal rotation that carries the old
                // tangent onto the new one; applying the same rotation to the
                // normal is the discrete parallel-transport step.
                Quaternion rotation = Quaternion.FromToRotation(previousTangent, currentTangent);
                Vector3 transported = rotation * rawNormals[i - 1];
                rawNormals[i] = Reorthogonalize(currentTangent, transported);
            }

            // The closing ring lives in ring 0's tangent plane; its transported
            // normal's angle against the starting normal is the residual twist.
            Vector3 closingNormal = Reorthogonalize(tangent0, rawNormals[total - 1]);
            float residualTwist = SignedAngleAroundAxis(
                closingNormal, normal0, tangent0);

            for (int i = 0; i < total; i++)
            {
                float fraction = (float)i / interiorCount;
                Quaternion unwind = Quaternion.AngleAxis(
                    residualTwist * Mathf.Rad2Deg * fraction, tangents[i].normalized);
                Vector3 corrected = Reorthogonalize(
                    tangents[i].normalized, unwind * rawNormals[i]);

                frames[i] = new Frame
                {
                    Position = positions[i],
                    Tangent = tangents[i].normalized,
                    Normal = corrected,
                    Binormal = Vector3.Cross(tangents[i].normalized, corrected).normalized,
                    RawNormal = rawNormals[i],
                };
            }

            return new Result { Frames = frames, ResidualTwistRadians = residualTwist };
        }

        /// <summary>
        /// Picks a stable unit vector perpendicular to the tangent by using the
        /// world axis with the smallest tangent component.
        /// </summary>
        public static Vector3 Perpendicular(Vector3 tangent)
        {
            Vector3 axis = Mathf.Abs(tangent.x) <= Mathf.Abs(tangent.y) &&
                           Mathf.Abs(tangent.x) <= Mathf.Abs(tangent.z)
                ? Vector3.right
                : Mathf.Abs(tangent.y) <= Mathf.Abs(tangent.z)
                    ? Vector3.up
                    : Vector3.forward;
            return Reorthogonalize(tangent, Vector3.Cross(tangent, axis));
        }

        /// <summary>Projects the candidate onto the tangent plane and renormalizes.</summary>
        public static Vector3 Reorthogonalize(Vector3 tangent, Vector3 candidate)
        {
            Vector3 projected = candidate - tangent * Vector3.Dot(tangent, candidate);
            float lengthSq = projected.sqrMagnitude;
            if (lengthSq < 1e-12f)
            {
                projected = Vector3.Cross(tangent,
                    Mathf.Abs(tangent.y) < 0.9f ? Vector3.up : Vector3.right);
                lengthSq = projected.sqrMagnitude;
            }
            return projected / Mathf.Sqrt(lengthSq);
        }

        private static float SignedAngleAroundAxis(Vector3 from, Vector3 to, Vector3 axis)
        {
            float dot = Mathf.Clamp(Vector3.Dot(from, to), -1f, 1f);
            float cross = Vector3.Dot(axis, Vector3.Cross(from, to));
            return Mathf.Atan2(cross, dot);
        }
    }
}
