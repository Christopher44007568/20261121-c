using SSSDemo;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering.HighDefinition;

namespace SSSDemo.EditorTools
{
    // One-click scene construction and measurement sweep from the Unity menu.
    public static class SSSDemoMenu
    {
        private const string ScenePath = "Assets/Scenes/SSSDemo.unity";

        [MenuItem("SSS Demo/Build Auricle Scene")]
        public static void BuildAuricleScene()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            EnsureHdrpAssets();

            var volumeObject = new GameObject("SSS Custom Pass Volume");
            var volume = volumeObject.AddComponent<CustomPassVolume>();
            volume.injectionPoint = CustomPassInjectionPoint.AfterOpaqueDepthAndNormal;
            volume.isGlobal = true;
            var pass = volume.AddPass<SSSDiffusionPass>();
            pass.radiusScale = 1f;

            var bootstrapObject = new GameObject("SSS Scene Bootstrap");
            var bootstrap = bootstrapObject.AddComponent<SSSSceneBootstrap>();
            bootstrap.mode = SSSSceneBootstrap.DemoMode.AuricleAndPlate;
            bootstrap.worldScale = 1f;

            var measurementObject = new GameObject("SSS Edge Measurement");
            measurementObject.AddComponent<SSSEdgeMeasurement>();

            EditorSceneManager.SaveScene(scene, ScenePath);
            Debug.Log("SSS auricle scene built at " + ScenePath);
        }

        [MenuItem("SSS Demo/Build Edge Measurement Scene")]
        public static void BuildEdgeScene()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            EnsureHdrpAssets();

            var volumeObject = new GameObject("SSS Custom Pass Volume");
            var volume = volumeObject.AddComponent<CustomPassVolume>();
            volume.injectionPoint = CustomPassInjectionPoint.AfterOpaqueDepthAndNormal;
            volume.isGlobal = true;
            volume.AddPass<SSSDiffusionPass>();

            var bootstrapObject = new GameObject("SSS Scene Bootstrap");
            var bootstrap = bootstrapObject.AddComponent<SSSSceneBootstrap>();
            bootstrap.mode = SSSSceneBootstrap.DemoMode.EdgeCards;

            EditorSceneManager.SaveScene(scene, ScenePath);
            Debug.Log("SSS edge measurement scene built.");
        }

        [MenuItem("SSS Demo/Run Edge Measurement Sweep")]
        public static void RunMeasurementSweep()
        {
            var measurement = Object.FindObjectOfType<SSSEdgeMeasurement>();
            if (measurement == null)
            {
                Debug.LogError("No SSSEdgeMeasurement in scene. Build the edge scene first.");
                return;
            }
            measurement.RunSweep(scaleProfileWithWorld: true);
            measurement.RunSweep(scaleProfileWithWorld: false);
        }

        private static void EnsureHdrpAssets()
        {
            if (GraphicsSettings.currentRenderPipeline is HDRenderPipelineAsset)
                return;
            Debug.LogWarning("Assign an HDRP asset in Graphics Settings before entering play mode.");
        }
    }
}
