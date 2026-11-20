using UnityEngine;

namespace RibbonMeshDemo
{
    /// <summary>
    /// Real-time closed 3D ribbon. Edit any control point, width or offset value
    /// (including dragging scene handles) and the mesh rebuilds immediately in
    /// play mode and in edit mode.
    /// </summary>
    [ExecuteAlways]
    [RequireComponent(typeof(MeshFilter), typeof(MeshRenderer))]
    public class RibbonMeshComponent : MonoBehaviour
    {
        [SerializeField] private RibbonSettings settings = new RibbonSettings();
        [SerializeField] private bool rebuildEveryFrame = true;
        [SerializeField] private bool showGizmos = true;

        private MeshFilter meshFilter;
        private Mesh runtimeMesh;
        private Vector3[] lastControlPoints;
        private int lastSettingsHash;
        private Frame[] debugFrames;
        private float residualTwist;

        public RibbonSettings Settings => settings;
        public Frame[] DebugFrames => debugFrames;
        public float ResidualTwistDegrees => residualTwist * Mathf.Rad2Deg;
        public bool ShowGizmos => showGizmos;

        private void OnEnable()
        {
            meshFilter = GetComponent<MeshFilter>();
            Rebuild();
        }

        private void OnValidate()
        {
            if (this == null || meshFilter == null)
            {
                return;
            }
            // OnValidate fires for every inspector edit and handle drag commit.
            Rebuild();
        }

        private void Update()
        {
            // Control points may be moved by other scripts every frame without
            // touching the inspector, so compare against the previous snapshot.
            if (rebuildEveryFrame && !ControlPointsUnchanged())
            {
                Rebuild();
            }
        }

        /// <summary>Force an immediate rebuild; call this after scripted edits.</summary>
        public void Rebuild()
        {
            if (meshFilter == null)
            {
                meshFilter = GetComponent<MeshFilter>();
            }

            RibbonMeshBuilder.BuildResult result = RibbonMeshBuilder.Build(settings);
            if (result == null)
            {
                return;
            }

            if (runtimeMesh == null)
            {
                runtimeMesh = new Mesh();
            }
            runtimeMesh.Clear();
            CopyMesh(result.Mesh, runtimeMesh);
            Object.DestroyImmediate(result.Mesh);
            meshFilter.sharedMesh = runtimeMesh;

            debugFrames = result.Frames;
            residualTwist = result.ResidualTwistRadians;
            lastControlPoints = (Vector3[])settings.ControlPoints.Clone();
            lastSettingsHash = ComputeSettingsHash();
        }

        private bool ControlPointsUnchanged()
        {
            if (lastControlPoints == null ||
                lastControlPoints.Length != settings.ControlPoints.Length ||
                ComputeSettingsHash() != lastSettingsHash)
            {
                return false;
            }
            for (int i = 0; i < lastControlPoints.Length; i++)
            {
                if (lastControlPoints[i] != settings.ControlPoints[i])
                {
                    return false;
                }
            }
            return true;
        }

        private int ComputeSettingsHash()
        {
            unchecked
            {
                int hash = settings.RingCount;
                hash = hash * 31 + settings.DenseSamplesPerSegment;
                hash = hash * 31 + settings.TextureRepeat.GetHashCode();
                hash = hash * 31 + settings.CorrectResidualTwist.GetHashCode();
                hash = hash * 31 + (settings.Widths == null ? 0 : settings.Widths.Length);
                hash = hash * 31 + (settings.WidthOffset == null ? 0 : settings.WidthOffset.Length);
                return hash;
            }
        }

        private static void CopyMesh(Mesh source, Mesh destination)
        {
            destination.indexFormat = source.indexFormat;
            destination.vertices = source.vertices;
            destination.normals = source.normals;
            destination.uv = source.uv;
            destination.triangles = source.triangles;
            destination.RecalculateBounds();
        }

        private void OnDrawGizmos()
        {
            if (!showGizmos || debugFrames == null || debugFrames.Length == 0)
            {
                return;
            }

            int stride = Mathf.Max(1, debugFrames.Length / 40);
            float scale = EstimateGizmoScale();

            for (int i = 0; i < debugFrames.Length; i += stride)
            {
                Frame frame = debugFrames[i];
                Vector3 origin = transform.TransformPoint(frame.Position);

                // Green: parallel-transport normal (across width).
                Gizmos.color = new Color(0.1f, 0.95f, 0.3f);
                Gizmos.DrawRay(origin, transform.TransformDirection(frame.Normal) * scale);

                // Blue: surface normal / binormal.
                Gizmos.color = new Color(0.25f, 0.55f, 1f);
                Gizmos.DrawRay(origin, transform.TransformDirection(frame.Binormal) * scale * 0.7f);
            }
        }

        private float EstimateGizmoScale()
        {
            if (settings.Widths != null && settings.Widths.Length > 0)
            {
                float max = float.MinValue;
                for (int i = 0; i < settings.Widths.Length; i++)
                {
                    max = Mathf.Max(max, settings.Widths[i]);
                }
                return max * 1.4f;
            }
            return 0.4f;
        }

        private void OnDestroy()
        {
            if (runtimeMesh != null)
            {
                Object.DestroyImmediate(runtimeMesh);
            }
        }
    }
}
