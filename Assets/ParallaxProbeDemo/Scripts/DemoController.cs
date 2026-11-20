using System.IO;
using UnityEngine;

namespace ParallaxProbeDemo
{
    /// <summary>
    /// Keyboard driver for the demo scene.
    ///   1/2/3 - switch scenario (Static / NearWall / BoundaryCrossing)
    ///   C     - toggle parallax correction on the "corrected" sphere
    ///   I     - toggle intensity-preserving probe blending
    ///   B     - debug view: probe blend weight (red = probe0, blue = probe1)
    ///   T     - export recorded trajectories to CSV
    /// </summary>
    public class DemoController : MonoBehaviour
    {
        public ProbePathMover[] movers;
        public ReflectionFeatureTracker[] trackers;
        public Material correctedMaterial;
        public Material uncorrectedMaterial;

        bool _correction = true;
        bool _preserveIntensity = true;
        bool _showBlendWeight;

        void Update()
        {
            if (Input.GetKeyDown(KeyCode.Alpha1)) SetMode(ProbePathMover.PathMode.Static);
            if (Input.GetKeyDown(KeyCode.Alpha2)) SetMode(ProbePathMover.PathMode.NearWallSweep);
            if (Input.GetKeyDown(KeyCode.Alpha3)) SetMode(ProbePathMover.PathMode.BoundaryCrossing);

            if (Input.GetKeyDown(KeyCode.C))
            {
                _correction = !_correction;
                correctedMaterial?.SetFloat("_CorrectionMode", _correction ? 1f : 0f);
            }
            if (Input.GetKeyDown(KeyCode.I))
            {
                _preserveIntensity = !_preserveIntensity;
                correctedMaterial?.SetFloat("_PreserveIntensity", _preserveIntensity ? 1f : 0f);
                uncorrectedMaterial?.SetFloat("_PreserveIntensity", _preserveIntensity ? 1f : 0f);
            }
            if (Input.GetKeyDown(KeyCode.B))
            {
                _showBlendWeight = !_showBlendWeight;
                correctedMaterial?.SetFloat("_ShowBlendWeight", _showBlendWeight ? 1f : 0f);
            }
            if (Input.GetKeyDown(KeyCode.T)) ExportAll();
        }

        void SetMode(ProbePathMover.PathMode mode)
        {
            foreach (var m in movers) if (m != null) m.mode = mode;
            foreach (var t in trackers) if (t != null) t.ClearSamples();
            Debug.Log($"[ParallaxProbeDemo] Scenario -> {mode}");
        }

        void ExportAll()
        {
            string dir = Path.Combine(Application.persistentDataPath, "trajectories");
            Directory.CreateDirectory(dir);
            for (int i = 0; i < trackers.Length; i++)
            {
                if (trackers[i] != null)
                    trackers[i].ExportCsv(Path.Combine(dir, $"trajectory_{i}.csv"));
            }
        }

        void OnGUI()
        {
            GUILayout.BeginArea(new Rect(10, 10, 460, 200), GUI.skin.box);
            GUILayout.Label("Parallax Reflection Probe Demo");
            GUILayout.Label("[1] Static  [2] NearWall  [3] BoundaryCrossing");
            GUILayout.Label($"[C] Correction: {(_correction ? "ON" : "OFF")}   " +
                            $"[I] PreserveIntensity: {(_preserveIntensity ? "ON" : "OFF")}   " +
                            $"[B] BlendWeightView: {(_showBlendWeight ? "ON" : "OFF")}");
            GUILayout.Label("[T] Export trajectory CSV");
            if (trackers != null)
            {
                foreach (var t in trackers)
                {
                    if (t != null)
                        GUILayout.Label($"{t.name}: feature {(t.FeatureInsideBox ? "INSIDE box (correctable)" : "BEYOND box (uncorrectable)")}");
                }
            }
            GUILayout.EndArea();
        }
    }
}
