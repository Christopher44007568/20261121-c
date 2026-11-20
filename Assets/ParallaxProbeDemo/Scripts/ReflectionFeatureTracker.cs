using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using UnityEngine;

namespace ParallaxProbeDemo
{
    /// <summary>
    /// Tracks where a room "feature" (a bright marker on a wall, or an object
    /// beyond the proxy box) appears on a mirror sphere, with and without
    /// box-projection parallax correction. Drives two trail markers and can
    /// export the trajectories to CSV.
    ///
    /// Classification:
    ///  - Correctable: feature lies inside the probe proxy box, so the
    ///    box-projection assumption (geometry on the box interior) holds.
    ///  - BeyondBox: feature is outside the proxy box (sky, outdoor geometry
    ///    seen through a window). Correction then produces a *wrong* but
    ///    stable position; the uncorrected lookup is the honest one.
    /// </summary>
    public class ReflectionFeatureTracker : MonoBehaviour
    {
        [Header("Scene references")]
        public Transform mirrorSphere;
        public Transform featurePoint;
        public ReflectionProbe probe;
        [Tooltip("Optional second probe; a feature counts as correctable if it is inside either proxy box.")]
        public ReflectionProbe secondaryProbe;
        public Camera viewCamera;

        [Header("Markers (auto-created if null)")]
        public Transform correctedMarker;
        public Transform uncorrectedMarker;
        public Color correctedColor = new Color(0.1f, 0.9f, 1f);
        public Color uncorrectedColor = new Color(1f, 0.45f, 0.1f);
        public float markerScale = 0.08f;

        [Header("Recording")]
        public bool record = true;
        public float sampleInterval = 0.05f;

        public bool FeatureInsideBox { get; private set; }
        public Vector3 CorrectedDirection { get; private set; }
        public Vector3 UncorrectedDirection { get; private set; }

        readonly List<float[]> _samples = new List<float[]>();
        float _sampleTimer;
        LineRenderer _correctedTrail;
        LineRenderer _uncorrectedTrail;

        void Start()
        {
            if (viewCamera == null) viewCamera = Camera.main;
            correctedMarker   = EnsureMarker(correctedMarker,   "CorrectedMarker",   correctedColor,   out _correctedTrail);
            uncorrectedMarker = EnsureMarker(uncorrectedMarker, "UncorrectedMarker", uncorrectedColor, out _uncorrectedTrail);
        }

        Transform EnsureMarker(Transform existing, string name, Color color, out LineRenderer trail)
        {
            Transform t = existing != null ? existing : GameObject.CreatePrimitive(PrimitiveType.Sphere).transform;
            t.name = name;
            t.localScale = Vector3.one * markerScale;
            if (existing == null)
            {
                Destroy(t.GetComponent<Collider>());
                var shader = Shader.Find("ParallaxProbeDemo/TrajectoryMarker");
                if (shader != null)
                {
                    var mat = new Material(shader) { color = color };
                    t.GetComponent<Renderer>().sharedMaterial = mat;
                }
            }
            trail = t.gameObject.AddComponent<LineRenderer>();
            trail.material = new Material(Shader.Find("Sprites/Default")) { color = color };
            trail.startWidth = trail.endWidth = 0.02f;
            trail.positionCount = 0;
            return t;
        }

        void Update()
        {
            if (mirrorSphere == null || featurePoint == null || probe == null || viewCamera == null)
                return;

            Vector3 spherePos = mirrorSphere.position;
            float radius = mirrorSphere.lossyScale.x * 0.5f;

            // Reflection direction at the sphere point facing the camera.
            Vector3 viewDir = (spherePos - viewCamera.transform.position).normalized;
            Vector3 normal = -viewDir; // approx: sphere normal at the silhouette centre
            Vector3 reflectDir = Vector3.Reflect(viewDir, normal).normalized;

            UncorrectedDirection = reflectDir;
            CorrectedDirection = BoxProject(reflectDir, spherePos, probe);

            FeatureInsideBox = WorldBounds(probe).Contains(featurePoint.position) ||
                               (secondaryProbe != null &&
                                WorldBounds(secondaryProbe).Contains(featurePoint.position));

            correctedMarker.position   = spherePos + CorrectedDirection   * (radius + markerScale);
            uncorrectedMarker.position = spherePos + UncorrectedDirection * (radius + markerScale);

            _sampleTimer -= Time.deltaTime;
            if (record && _sampleTimer <= 0f)
            {
                _sampleTimer = sampleInterval;
                RecordSample();
                AppendTrail(_correctedTrail, correctedMarker.position);
                AppendTrail(_uncorrectedTrail, uncorrectedMarker.position);
            }
        }

        void RecordSample()
        {
            Vector3 f = featurePoint.position;
            _samples.Add(new[]
            {
                Time.time,
                CorrectedDirection.x, CorrectedDirection.y, CorrectedDirection.z,
                UncorrectedDirection.x, UncorrectedDirection.y, UncorrectedDirection.z,
                f.x, f.y, f.z,
                FeatureInsideBox ? 1f : 0f
            });
        }

        static void AppendTrail(LineRenderer trail, Vector3 p)
        {
            const int maxPoints = 2000;
            if (trail.positionCount >= maxPoints) return;
            trail.positionCount++;
            trail.SetPosition(trail.positionCount - 1, p);
        }

        /// <summary>Mirror of the shader's BoxProjectedCubemapDirection.</summary>
        public static Vector3 BoxProject(Vector3 dir, Vector3 pos, ReflectionProbe probe)
        {
            Bounds b = WorldBounds(probe);
            Vector3 min = b.min, max = b.max;
            Vector3 magnitudes = new Vector3(
                (dir.x > 0 ? max.x : min.x) - pos.x,
                (dir.y > 0 ? max.y : min.y) - pos.y,
                (dir.z > 0 ? max.z : min.z) - pos.z);
            magnitudes = new Vector3(
                magnitudes.x / dir.x, magnitudes.y / dir.y, magnitudes.z / dir.z);
            float t = Mathf.Min(magnitudes.x, Mathf.Min(magnitudes.y, magnitudes.z));
            Vector3 hit = pos + dir * t;
            return (hit - probe.transform.position).normalized;
        }

        public static Bounds WorldBounds(ReflectionProbe probe)
        {
            return new Bounds(probe.transform.position + probe.center, probe.size);
        }

        public void ExportCsv(string path)
        {
            var sb = new StringBuilder();
            sb.AppendLine("time,corr_x,corr_y,corr_z,raw_x,raw_y,raw_z,feat_x,feat_y,feat_z,inside_box");
            var inv = CultureInfo.InvariantCulture;
            foreach (var s in _samples)
            {
                for (int i = 0; i < s.Length; i++)
                {
                    if (i > 0) sb.Append(',');
                    sb.Append(s[i].ToString("G9", inv));
                }
                sb.Append('\n');
            }
            File.WriteAllText(path, sb.ToString());
            Debug.Log($"[ParallaxProbeDemo] Wrote {_samples.Count} samples to {path}");
        }

        public void ClearSamples()
        {
            _samples.Clear();
            if (_correctedTrail != null) _correctedTrail.positionCount = 0;
            if (_uncorrectedTrail != null) _uncorrectedTrail.positionCount = 0;
        }
    }
}
