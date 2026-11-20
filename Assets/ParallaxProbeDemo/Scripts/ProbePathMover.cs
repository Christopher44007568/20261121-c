using UnityEngine;

namespace ParallaxProbeDemo
{
    /// <summary>
    /// Moves a transform (reflection probe, mirror sphere or camera rig) along
    /// one of the demo paths used to compare parallax-correction behaviour:
    /// static, sweeping close to a wall, or crossing a probe boundary.
    /// </summary>
    public class ProbePathMover : MonoBehaviour
    {
        public enum PathMode
        {
            Static,
            NearWallSweep,
            BoundaryCrossing
        }

        [Header("Path")]
        public PathMode mode = PathMode.Static;
        public float speed = 0.35f;
        public Vector3 staticPosition = new Vector3(0f, 1.5f, 0f);
        public Vector3 sweepCenter = new Vector3(0f, 1.5f, 0f);
        public Vector3 sweepAxis = Vector3.right;
        public float sweepAmplitude = 3.5f;
        [Tooltip("Extra offset pushing the path towards a wall in NearWallSweep mode.")]
        public Vector3 nearWallOffset = new Vector3(0f, 0f, 3.8f);

        [Header("Optional realtime probe refresh")]
        public ReflectionProbe probeToRefresh;

        Vector3 _basePosition;
        float _phase;

        void OnEnable()
        {
            _basePosition = transform.position;
        }

        void Update()
        {
            _phase += Time.deltaTime * speed;
            float s = Mathf.Sin(_phase * Mathf.PI * 2f);
            Vector3 offset;
            switch (mode)
            {
                case PathMode.NearWallSweep:
                    offset = nearWallOffset + sweepAxis * (s * sweepAmplitude * 0.4f);
                    break;
                case PathMode.BoundaryCrossing:
                    offset = sweepAxis * (s * sweepAmplitude);
                    break;
                default:
                    offset = staticPosition - _basePosition;
                    break;
            }

            transform.position = _basePosition + offset;

            if (probeToRefresh != null &&
                probeToRefresh.mode == UnityEngine.Rendering.ReflectionProbeMode.Realtime)
            {
                probeToRefresh.RenderProbe();
            }
        }
    }
}
