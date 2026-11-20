using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace ParallaxProbeDemo.EditorTools
{
    /// <summary>
    /// Builds the full demo scene: a box room with trackable wall features,
    /// two overlapping box-projected reflection probes, a corrected and an
    /// uncorrected mirror sphere, movers, trackers and a controller.
    /// Menu: Parallax Probe Demo > Build Demo Scene
    /// </summary>
    public static class DemoSceneBuilder
    {
        const string AssetDir = "Assets/ParallaxProbeDemo/Generated";

        [MenuItem("Parallax Probe Demo/Build Demo Scene")]
        public static void Build()
        {
            EnsurePipeline();
            Directory.CreateDirectory(AssetDir);
            AssetDatabase.Refresh();

            var root = new GameObject("ParallaxProbeDemo");
            BuildRoom(root.transform);
            var featureInside = CreateFeature(root.transform, "Feature_Inside",
                new Vector3(4.7f, 1.6f, 0f), Color.cyan);
            var featureBeyond = CreateFeature(root.transform, "Feature_BeyondBox",
                new Vector3(0f, 8f, 20f), Color.yellow);

            // Proxy boxes coincide with the room walls and overlap on x in [-1, 1],
            // which is the region where URP blends the two probes.
            var probeA = CreateProbe(root.transform, "Probe_Left",
                new Vector3(-2f, 1.5f, 0f), new Vector3(6f, 3f, 10f), 1);
            var probeB = CreateProbe(root.transform, "Probe_Right",
                new Vector3(2f, 1.5f, 0f), new Vector3(6f, 3f, 10f), 2);

            var matCorrected = CreateMirrorMaterial("Mirror_Corrected", 1f);
            var matRaw = CreateMirrorMaterial("Mirror_Uncorrected", 0f);
            var sphereCorrected = CreateSphere(root.transform, "Sphere_Corrected",
                new Vector3(-1.2f, 1.5f, 2f), matCorrected);
            var sphereRaw = CreateSphere(root.transform, "Sphere_Uncorrected",
                new Vector3(1.2f, 1.5f, 2f), matRaw);

            var camRig = new GameObject("CameraRig");
            camRig.transform.SetParent(root.transform);
            camRig.transform.position = new Vector3(0f, 1.6f, -4f);
            var camGo = new GameObject("Main Camera");
            camGo.tag = "MainCamera";
            camGo.transform.SetParent(camRig.transform, false);
            var cam = camGo.AddComponent<Camera>();
            cam.transform.LookAt(new Vector3(0f, 1.5f, 2f));

            var mover = camRig.AddComponent<ProbePathMover>();
            mover.mode = ProbePathMover.PathMode.Static;
            mover.sweepAxis = Vector3.right;

            var lightGo = new GameObject("Key Light");
            lightGo.transform.SetParent(root.transform);
            lightGo.transform.rotation = Quaternion.Euler(50f, -30f, 0f);
            var light = lightGo.AddComponent<Light>();
            light.type = LightType.Directional;

            var trackerInside = CreateTracker(root.transform, "Tracker_Inside",
                sphereCorrected.transform, featureInside, probeA, cam);
            var trackerBeyond = CreateTracker(root.transform, "Tracker_BeyondBox",
                sphereCorrected.transform, featureBeyond, probeA, cam);
            trackerInside.secondaryProbe = probeB;
            trackerBeyond.secondaryProbe = probeB;

            var controller = root.AddComponent<DemoController>();
            controller.movers = new[] { mover };
            controller.trackers = new[] { trackerInside, trackerBeyond };
            controller.correctedMaterial = matCorrected;
            controller.uncorrectedMaterial = matRaw;

            Selection.activeGameObject = root;
            Debug.Log("[ParallaxProbeDemo] Demo scene built. Enter Play Mode, keys 1/2/3/C/I/B/T.");
        }

        static void EnsurePipeline()
        {
            if (GraphicsSettings.defaultRenderPipeline is UniversalRenderPipelineAsset)
                return;
            var urp = UniversalRenderPipelineAsset.Create();
            AssetDatabase.CreateAsset(urp, AssetDir + "/URP_Asset.asset");
            GraphicsSettings.defaultRenderPipeline = urp;
            QualitySettings.renderPipeline = urp;
        }

        static void BuildRoom(Transform parent)
        {
            var room = new GameObject("Room");
            room.transform.SetParent(parent);
            AddWall(room.transform, "Floor",   new Vector3(0, 0, 0),    new Vector3(10, 0.1f, 10), new Color(0.5f, 0.5f, 0.55f));
            AddWall(room.transform, "Ceiling", new Vector3(0, 3, 0),    new Vector3(10, 0.1f, 10), new Color(0.6f, 0.6f, 0.6f));
            AddWall(room.transform, "WallN",   new Vector3(0, 1.5, 5),  new Vector3(10, 3, 0.1f),  new Color(0.7f, 0.3f, 0.25f));
            AddWall(room.transform, "WallS",   new Vector3(0, 1.5, -5), new Vector3(10, 3, 0.1f),  new Color(0.25f, 0.45f, 0.7f));
            AddWall(room.transform, "WallE",   new Vector3(5, 1.5, 0),  new Vector3(0.1f, 3, 10),  new Color(0.3f, 0.65f, 0.35f));
            AddWall(room.transform, "WallW",   new Vector3(-5, 1.5, 0), new Vector3(0.1f, 3, 10),  new Color(0.75f, 0.65f, 0.3f));
        }

        static void AddWall(Transform parent, string name, Vector3 pos, Vector3 scale, Color color)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(parent);
            go.transform.position = pos;
            go.transform.localScale = scale;
            var mat = new Material(Shader.Find("Universal Render Pipeline/Lit")) { color = color };
            go.GetComponent<Renderer>().sharedMaterial = mat;
        }

        static Transform CreateFeature(Transform parent, string name, Vector3 pos, Color color)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            go.name = name;
            go.transform.SetParent(parent);
            go.transform.position = pos;
            go.transform.localScale = Vector3.one * 0.35f;
            var mat = new Material(Shader.Find("Universal Render Pipeline/Lit")) { color = color };
            mat.EnableKeyword("_EMISSION");
            mat.SetColor("_EmissionColor", color * 4f);
            go.GetComponent<Renderer>().sharedMaterial = mat;
            return go.transform;
        }

        static ReflectionProbe CreateProbe(Transform parent, string name, Vector3 pos, Vector3 size, int importance)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent);
            go.transform.position = pos;
            var probe = go.AddComponent<ReflectionProbe>();
            probe.mode = ReflectionProbeMode.Realtime;
            probe.refreshMode = ReflectionProbeRefreshMode.ViaScripting;
            probe.timeSlicingMode = ReflectionProbeTimeSlicingMode.NoTimeSlicing;
            probe.boxProjection = true;
            probe.size = size;
            probe.importance = importance;
            probe.resolution = 256;
            return probe;
        }

        static Material CreateMirrorMaterial(string name, float correction)
        {
            var mat = new Material(Shader.Find("ParallaxProbeDemo/MirrorProbeSphere"));
            mat.SetFloat("_CorrectionMode", correction);
            AssetDatabase.CreateAsset(mat, $"{AssetDir}/{name}.mat");
            return mat;
        }

        static GameObject CreateSphere(Transform parent, string name, Vector3 pos, Material mat)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            go.name = name;
            go.transform.SetParent(parent);
            go.transform.position = pos;
            go.GetComponent<Renderer>().sharedMaterial = mat;
            return go;
        }

        static ReflectionFeatureTracker CreateTracker(Transform parent, string name,
            Transform sphere, Transform feature, ReflectionProbe probe, Camera cam)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent);
            var tracker = go.AddComponent<ReflectionFeatureTracker>();
            tracker.mirrorSphere = sphere;
            tracker.featurePoint = feature;
            tracker.probe = probe;
            tracker.viewCamera = cam;
            return tracker;
        }
    }
}
