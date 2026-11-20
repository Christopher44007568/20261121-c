using RibbonMeshDemo;
using UnityEditor;
using UnityEngine;

namespace RibbonMeshDemo.Editor
{
    /// <summary>
    /// Adds demo menus, a residual-twist readout, rebuild button and draggable
    /// scene-view handles for every control point. Dragging a handle commits a
    /// serialized edit, which triggers the component's real-time rebuild.
    /// </summary>
    [CustomEditor(typeof(RibbonMeshComponent))]
    public class RibbonMeshEditor : UnityEditor.Editor
    {
        private const float HandleSize = 0.16f;

        [MenuItem("GameObject/Ribbon Mesh/Create Demo Ribbons", false, 10)]
        private static void CreateDemoRibbons()
        {
            var root = new GameObject("RibbonDemos");
            Undo.RegisterCreatedObjectUndo(root, "Create Demo Ribbons");
            RibbonDemoSpawner.CreateAll(root.transform);
            Selection.activeGameObject = root;
        }

        public override void OnInspectorGUI()
        {
            DrawDefaultInspector();

            var component = (RibbonMeshComponent)target;
            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Diagnostics", EditorStyles.boldLabel);
            EditorGUILayout.LabelField(
                "Residual twist (pre-correction)",
                component.ResidualTwistDegrees.ToString("F2") + " deg");

            if (GUILayout.Button("Rebuild Ribbon"))
            {
                component.Rebuild();
                EditorUtility.SetDirty(target);
            }
        }

        private void OnSceneGUI()
        {
            var component = (RibbonMeshComponent)target;
            RibbonSettings settings = component.Settings;
            if (settings.ControlPoints == null || settings.ControlPoints.Length == 0)
            {
                return;
            }

            Transform transform = component.transform;
            for (int i = 0; i < settings.ControlPoints.Length; i++)
            {
                Vector3 worldPosition = transform.TransformPoint(settings.ControlPoints[i]);
                float size = HandleUtility.GetHandleSize(worldPosition) * HandleSize;

                EditorGUI.BeginChangeCheck();
                Vector3 newWorld = Handles.FreeMoveHandle(
                    worldPosition, size, Vector3.zero, Handles.SphereHandleCap);
                if (EditorGUI.EndChangeCheck())
                {
                    Undo.RecordObject(component, "Move Ribbon Control Point");
                    settings.ControlPoints[i] = transform.InverseTransformPoint(newWorld);
                    EditorUtility.SetDirty(component);
                    component.Rebuild();
                }

                Handles.Label(worldPosition + Vector3.up * size, "P" + i);
            }

            DrawFrenetComparison(component);
        }

        // Red lines show what a Frenet-style normal does at inflections: it
        // swings violently or flips. The green gizmos from the component itself
        // are the transported normals, which stay continuous.
        private static void DrawFrenetComparison(RibbonMeshComponent component)
        {
            Frame[] frames = component.DebugFrames;
            if (frames == null || frames.Length < 3)
            {
                return;
            }

            Transform transform = component.transform;
            int stride = Mathf.Max(1, frames.Length / 28);
            float scale = 0.55f;

            for (int i = 0; i < frames.Length - 2; i += stride)
            {
                Vector3 tangentA = frames[i].Tangent;
                Vector3 tangentB = frames[Mathf.Min(i + 1, frames.Length - 1)].Tangent;
                Vector3 curvature = tangentB - tangentA;
                if (curvature.sqrMagnitude < 1e-9f)
                {
                    continue;
                }

                Vector3 frenetNormal = curvature.normalized;
                Vector3 origin = transform.TransformPoint(frames[i].Position);
                Handles.color = new Color(1f, 0.2f, 0.15f, 0.85f);
                Handles.DrawLine(
                    origin,
                    origin + transform.TransformDirection(frenetNormal) * scale, 2f);
            }
        }
    }
}
