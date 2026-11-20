using UnityEngine;

namespace RibbonMeshDemo
{
    /// <summary>
    /// Procedurally builds a deliberately asymmetric ribbon texture.
    /// U runs along the ribbon (directional chevrons expose twist at the seam),
    /// V runs across the width and is deliberately lopsided so a geometric
    /// width offset is immediately visible.
    /// </summary>
    public static class RibbonTextureFactory
    {
        public static Texture2D CreateAsymmetricTexture(int resolution = 256)
        {
            var texture = new Texture2D(resolution, resolution, TextureFormat.RGBA32, true)
            {
                name = "AsymmetricRibbonTexture",
                wrapMode = TextureWrapMode.Repeat,
                filterMode = FilterMode.Bilinear,
            };

            var pixels = new Color32[resolution * resolution];
            for (int y = 0; y < resolution; y++)
            {
                float v = (float)y / (resolution - 1);
                for (int x = 0; x < resolution; x++)
                {
                    float u = (float)x / (resolution - 1);
                    pixels[y * resolution + x] = EvaluatePixel(u, v, resolution);
                }
            }

            texture.SetPixels32(pixels);
            texture.Apply();
            return texture;
        }

        private static Color32 EvaluatePixel(float u, float v, int resolution)
        {
            Color baseColor = v < 0.5f
                ? new Color(0.16f, 0.22f, 0.34f)
                : new Color(0.55f, 0.48f, 0.30f);

            // Longitudinal checker bands make seam mismatch obvious.
            int band = Mathf.FloorToInt(u * 12f);
            if (band % 2 == 0)
            {
                baseColor = Color.Lerp(baseColor, Color.white, 0.12f);
            }

            // Thick marker band sits off-center on purpose (asymmetry in V).
            float markerDistance = Mathf.Abs(v - 0.72f);
            if (markerDistance < 0.05f)
            {
                baseColor = Color.Lerp(baseColor, new Color(1f, 0.45f, 0.1f), 0.85f);
            }

            // Thin centerline marks the design center of the texture.
            if (Mathf.Abs(v - 0.5f) < 0.012f)
            {
                baseColor = Color.Lerp(baseColor, Color.black, 0.6f);
            }

            // Edge stripes identify which side is which after transport.
            if (v < 0.04f)
            {
                baseColor = new Color(0.9f, 0.15f, 0.2f);
            }
            if (v > 0.96f)
            {
                baseColor = new Color(0.2f, 0.85f, 0.9f);
            }

            if (InsideChevron(u, v, resolution))
            {
                baseColor = Color.Lerp(baseColor, new Color(1f, 0.95f, 0.55f), 0.9f);
            }
            return baseColor;
        }

        private static bool InsideChevron(float u, float v, int resolution)
        {
            // Repeating arrows pointing toward increasing U; a broken arrow at
            // the closing seam means residual twist was not removed.
            float local = Mathf.Repeat(u * 3f, 1f);
            float chevron = 1f - Mathf.Abs(v - 0.5f) * 1.6f;
            float distance = Mathf.Abs(local - chevron);
            float halfThickness = 1.5f / resolution;
            return distance < halfThickness && chevron > 0.08f;
        }
    }
}
