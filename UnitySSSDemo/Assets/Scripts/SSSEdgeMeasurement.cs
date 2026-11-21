using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using UnityEngine;

namespace SSSDemo
{
    // Measures the scattered radius across the hard light edge.
    // Radius definition matches the offline report:
    //   radius_px = (x10 - x90) / 2 on the dark side of the edge,
    // then converted to world millimetres with the camera projection:
    //   pixels_per_m = H / (2 d tan(FovY/2)).
    public sealed class SSSEdgeMeasurement : MonoBehaviour
    {
        public Camera targetCamera;
        public int resolutionHeight = 720;
        public float verticalFov = 30f;
        public float cameraDistance = 0.336f;
        public string outputPath = "Measurements/edge_measurements.csv";
        public float[] scales = { 0.5f, 0.75f, 1f, 1.25f, 1.5f, 2f, 3f, 4f };

        private struct Row
        {
            public float Scale;
            public string Mode;
            public float RadiusScale;
            public float PixelsPerM;
            public float RadiusPx;
            public float RadiusWorldMm;
        }

        public void RunSweep(bool scaleProfileWithWorld)
        {
            var rows = new List<Row>();
            var pass = FindObjectOfType<SSSDiffusionPass>(true);
            foreach (float scale in scales)
            {
                if (pass != null)
                    pass.radiusScale = scaleProfileWithWorld ? scale : 1f;
                float radiusPx = MeasurePixelRadius(out float pixelsPerM, scale);
                rows.Add(new Row
                {
                    Scale = scale,
                    Mode = scaleProfileWithWorld ? "profile_scaled" : "profile_fixed",
                    RadiusScale = scaleProfileWithWorld ? scale : 1f,
                    PixelsPerM = pixelsPerM,
                    RadiusPx = radiusPx,
                    RadiusWorldMm = radiusPx / pixelsPerM * 1000f
                });
            }
            WriteCsv(rows);
        }

        private float MeasurePixelRadius(out float pixelsPerM, float scale)
        {
            float distance = cameraDistance * scale;
            float tanHalfFov = Mathf.Tan(verticalFov * Mathf.Deg2Rad * 0.5f);
            pixelsPerM = resolutionHeight / (2f * distance * tanHalfFov);

            // Read back the active camera target at the requested 16:9 size.
            int width = resolutionHeight * 16 / 9;
            var capture = new Texture2D(width, resolutionHeight, TextureFormat.RGB24, false);
            var previousTarget = RenderTexture.active;
            if (targetCamera != null && targetCamera.targetTexture != null)
                RenderTexture.active = targetCamera.targetTexture;
            capture.ReadPixels(new Rect(0, 0, capture.width, capture.height), 0, 0);
            capture.Apply();
            RenderTexture.active = previousTarget;

            int rowY = capture.height / 2;
            int edgeX = capture.width / 2;
            var profile = new float[capture.width];
            for (int x = 0; x < capture.width; x++)
                profile[x] = capture.GetPixel(x, rowY).r;

            float dark = profile[Mathf.Max(0, edgeX - 80)];
            float lit = profile[Mathf.Min(capture.width - 1, edgeX + 80)];
            float level10 = dark + (lit - dark) * 0.10f;
            float level90 = dark + (lit - dark) * 0.90f;

            float x10 = FindCrossing(profile, edgeX, level10, +1);
            float x90 = FindCrossing(profile, edgeX, level90, +1);
            DestroyImmediate(capture);
            return Mathf.Abs(x10 - x90) * 0.5f;
        }

        private static float FindCrossing(float[] profile, int edgeX, float level, int direction)
        {
            for (int x = edgeX; x > 0 && x < profile.Length - 1; x += direction)
            {
                float a = profile[x];
                float b = profile[x + direction];
                if ((a <= level && b >= level) || (a >= level && b <= level))
                {
                    float t = (level - a) / Mathf.Max(b - a, 1e-6f);
                    return x + t * direction;
                }
            }
            return edgeX;
        }

        private void WriteCsv(List<Row> rows)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outputPath)) ?? ".");
            var builder = new StringBuilder();
            builder.AppendLine("scale,mode,radius_scale,pixels_per_m,radius_px,radius_world_mm");
            foreach (var row in rows)
            {
                builder.AppendLine(string.Format(CultureInfo.InvariantCulture,
                    "{0},{1},{2},{3},{4},{5}",
                    row.Scale, row.Mode, row.RadiusScale, row.PixelsPerM,
                    row.RadiusPx, row.RadiusWorldMm));
            }
            File.WriteAllText(outputPath, builder.ToString());
            Debug.Log($"SSS edge measurement written to {outputPath}");
        }
    }
}
