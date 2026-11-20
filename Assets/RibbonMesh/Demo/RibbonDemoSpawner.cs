using UnityEngine;

namespace RibbonMeshDemo
{
    public enum RibbonDemoPreset
    {
        HelixLoop,
        InflectionLoop,
        NearlyStationaryPoints,
    }

    /// <summary>
    /// Builds the three showcase ribbons as separate child objects, each with a
    /// material using the procedural asymmetric texture.
    /// </summary>
    public static class RibbonDemoSpawner
    {
        private static readonly int BaseMapId = Shader.PropertyToID("_BaseMap");
        private static readonly int MainTexId = Shader.PropertyToID("_MainTex");

        public static RibbonMeshComponent Create(
            RibbonDemoPreset preset, Transform parent = null)
        {
            var gameObject = new GameObject(preset.ToString());
            gameObject.transform.SetParent(parent, false);
            var component = gameObject.AddComponent<RibbonMeshComponent>();
            var meshRenderer = gameObject.GetComponent<MeshRenderer>();

            RibbonSettings settings = component.Settings;
            switch (preset)
            {
                case RibbonDemoPreset.HelixLoop:
                    ConfigureHelix(settings);
                    break;
                case RibbonDemoPreset.InflectionLoop:
                    ConfigureInflection(settings);
                    break;
                default:
                    ConfigureStationary(settings);
                    break;
            }

            meshRenderer.sharedMaterial = CreateMaterial();
            component.Rebuild();
            return component;
        }

        public static void CreateAll(Transform parent = null)
        {
            Create(RibbonDemoPreset.HelixLoop, parent);
            var inflection = Create(RibbonDemoPreset.InflectionLoop, parent);
            inflection.transform.position = new Vector3(7f, 0f, 0f);
            var stationary = Create(RibbonDemoPreset.NearlyStationaryPoints, parent);
            stationary.transform.position = new Vector3(14f, 0f, 0f);
        }

        // A closed loop that rises and falls while winding: substantial natural
        // torsion, so the residual-twist readout is clearly non-zero before
        // correction but the seam stays continuous after it.
        private static void ConfigureHelix(RibbonSettings settings)
        {
            const int count = 9;
            settings.ControlPoints = new Vector3[count];
            settings.Widths = new float[count];
            settings.WidthOffset = new float[count];
            for (int i = 0; i < count; i++)
            {
                float angle = i * Mathf.PI * 2f / count;
                float radius = 2.4f + 0.5f * Mathf.Sin(angle * 2f);
                settings.ControlPoints[i] = new Vector3(
                    radius * Mathf.Cos(angle),
                    1.6f * Mathf.Sin(angle * 2f),
                    radius * Mathf.Sin(angle));
                settings.Widths[i] = 0.42f + 0.1f * Mathf.Sin(angle * 3f);
                settings.WidthOffset[i] = 0.62f;
            }
            settings.RingCount = 260;
            settings.TextureRepeat = 8f;
            settings.CorrectResidualTwist = true;
        }

        // Planar figure-eight style closed loop. Curvature passes through zero at
        // the crossing region: Frenet normals would flip there, while the
        // transported normals stay continuous.
        private static void ConfigureInflection(RibbonSettings settings)
        {
            settings.ControlPoints = new[]
            {
                new Vector3(-2.6f, 0f, 0f),
                new Vector3(-1.1f, 0.25f, 1.5f),
                new Vector3(0f, 0f, 0f),
                new Vector3(1.1f, -0.25f, 1.5f),
                new Vector3(2.6f, 0f, 0f),
                new Vector3(1.1f, 0.25f, -1.5f),
                new Vector3(0f, 0f, 0f),
                new Vector3(-1.1f, -0.25f, -1.5f),
            };
            int count = settings.ControlPoints.Length;
            settings.Widths = ConstantArray(count, 0.46f);
            settings.WidthOffset = ConstantArray(count, 0.35f);
            settings.RingCount = 260;
            settings.TextureRepeat = 7f;
            settings.CorrectResidualTwist = true;
        }

        // Two adjacent control points almost coincide. The spline must remain
        // finite and the frames must stay orthonormal instead of collapsing.
        private static void ConfigureStationary(RibbonSettings settings)
        {
            settings.ControlPoints = new[]
            {
                new Vector3(-2.2f, 0f, 0f),
                new Vector3(-0.8f, 0.35f, 1.3f),
                new Vector3(0.79995f, 0.05f, 0.6f),
                new Vector3(0.8f, 0.05f, 0.6f),
                new Vector3(2.2f, 0f, 0f),
                new Vector3(0.8f, -0.3f, -1.4f),
            };
            int count = settings.ControlPoints.Length;
            settings.Widths = new[] { 0.4f, 0.4f, 0.28f, 0.28f, 0.4f, 0.4f };
            settings.WidthOffset = ConstantArray(count, 0.55f);
            settings.RingCount = 240;
            settings.DenseSamplesPerSegment = 32;
            settings.TextureRepeat = 6f;
            settings.CorrectResidualTwist = true;
        }

        private static float[] ConstantArray(int count, float value)
        {
            var array = new float[count];
            for (int i = 0; i < count; i++)
            {
                array[i] = value;
            }
            return array;
        }

        private static Material CreateMaterial()
        {
            Shader shader = Shader.Find("RibbonMesh/UnlitDoubleSided");
            if (shader == null)
            {
                shader = Shader.Find("Unlit/Texture");
            }
            var material = new Material(shader);
            Texture texture = RibbonTextureFactory.CreateAsymmetricTexture();
            if (material.HasProperty(BaseMapId))
            {
                material.SetTexture(BaseMapId, texture);
            }
            if (material.HasProperty(MainTexId))
            {
                material.SetTexture(MainTexId, texture);
            }
            return material;
        }
    }
}
