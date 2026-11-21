using UnityEngine;

namespace SSSDemo
{
    // Builds the demo scene procedurally so no binary mesh assets are required:
    //   ID 1: thin auricle shell, vertex thickness 0.45-2.4 mm
    //   ID 2: 40 mm opaque backing plate
    //   ID 3 / 4: two zero-gap edge measurement cards with a hard light boundary
    public sealed class SSSSceneBootstrap : MonoBehaviour
    {
        public enum DemoMode { AuricleAndPlate, EdgeCards }

        [Header("Scene")]
        public DemoMode mode = DemoMode.AuricleAndPlate;
        public Material sssMaterialTemplate;
        public float worldScale = 1f;

        [Header("Camera")]
        public float cameraDistance = 0.336f;
        public float verticalFov = 30f;

        private static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");
        private static readonly int MaterialIdId = Shader.PropertyToID("_MaterialID");
        private static readonly int ThicknessId = Shader.PropertyToID("_VertexThickness");
        private static readonly int WorldScaleId = Shader.PropertyToID("_WorldScale");
        private static readonly int KeyDirId = Shader.PropertyToID("_SSSKeyLightDir");
        private static readonly int KeyColorId = Shader.PropertyToID("_SSSKeyLightColor");
        private static readonly int AmbientId = Shader.PropertyToID("_SSSAmbient");

        private void Awake()
        {
            ConfigureGlobalLighting();
            ConfigureCamera();

            if (mode == DemoMode.AuricleAndPlate)
                BuildAuricleScene();
            else
                BuildEdgeCardScene();
        }

        private void ConfigureGlobalLighting()
        {
            Shader.SetGlobalVector(KeyDirId, new Vector4(-0.55f, -0.35f, 0.75f, 2.4f));
            Shader.SetGlobalColor(KeyColorId, new Color(1f, 0.92f, 0.84f, 1f));
            Shader.SetGlobalVector(AmbientId, new Vector4(0.08f, 0.09f, 0.12f, 0f));
        }

        private void ConfigureCamera()
        {
            var camera = Camera.main;
            if (camera == null)
            {
                var cameraObject = new GameObject("Main Camera");
                cameraObject.tag = "MainCamera";
                camera = cameraObject.AddComponent<Camera>();
            }
            camera.transform.position = new Vector3(0, 0, -cameraDistance * worldScale);
            camera.transform.rotation = Quaternion.LookRotation(Vector3.forward, Vector3.up);
            camera.fieldOfView = verticalFov;
            camera.nearClipPlane = 0.01f * worldScale;
            camera.farClipPlane = 10f * worldScale;
        }

        private Material MakeMaterial(Color color, float id, float thicknessM)
        {
            var material = sssMaterialTemplate != null
                ? Instantiate(sssMaterialTemplate)
                : new Material(Shader.Find("Custom/HDRP/SSSMaterial"));
            material.SetColor(BaseColorId, color);
            material.SetFloat(MaterialIdId, id);
            material.SetFloat(ThicknessId, thicknessM);
            material.SetFloat(WorldScaleId, worldScale);
            return material;
        }

        private void BuildAuricleScene()
        {
            // Backing plate, 40 mm thick, opaque to the diffuse transport.
            var plate = GameObject.CreatePrimitive(PrimitiveType.Cube);
            plate.name = "BackingPlate_ID2_40mm";
            plate.transform.localScale = new Vector3(0.16f, 0.20f, 0.04f) * worldScale;
            plate.transform.position = new Vector3(0, 0, 0.025f);
            var plateMaterial = MakeMaterial(new Color(0.18f, 0.23f, 0.28f), 2f, 0.040f);
            plate.GetComponent<MeshRenderer>().sharedMaterial = plateMaterial;

            // Thin auricle shell: a ring mesh whose vertex colors carry a thickness
            // multiplier between 0.375 (0.45 mm) and 2.0 (2.4 mm).
            var auricle = new GameObject("Auricle_ID1_ThinShell");
            var auricleMesh = AuricleMeshBuilder.Build(worldScale);
            var auricleFilter = auricle.AddComponent<MeshFilter>();
            auricleFilter.sharedMesh = auricleMesh;
            var auricleRenderer = auricle.AddComponent<MeshRenderer>();
            auricleRenderer.sharedMaterial = MakeMaterial(new Color(0.86f, 0.42f, 0.28f), 1f, 0.0012f);
            auricle.transform.position = new Vector3(0, 0, -0.005f);
        }

        private void BuildEdgeCardScene()
        {
            // Two cards share a zero-gap seam at x = 0 and carry different IDs.
            // The green vertex channel encodes the hard light step (0 -> 1).
            var left = new GameObject("EdgeCard_ID3_Dark");
            var leftMesh = EdgeCardBuilder.Build(side: -1, worldScale: worldScale);
            left.AddComponent<MeshFilter>().sharedMesh = leftMesh;
            left.AddComponent<MeshRenderer>().sharedMaterial =
                MakeMaterial(new Color(0.12f, 0.15f, 0.28f), 3f, 0.00055f);

            var right = new GameObject("EdgeCard_ID4_Lit");
            var rightMesh = EdgeCardBuilder.Build(side: 1, worldScale: worldScale);
            right.AddComponent<MeshFilter>().sharedMesh = rightMesh;
            right.AddComponent<MeshRenderer>().sharedMaterial =
                MakeMaterial(new Color(0.78f, 0.62f, 0.58f), 4f, 0.00055f);
        }
    }
}
