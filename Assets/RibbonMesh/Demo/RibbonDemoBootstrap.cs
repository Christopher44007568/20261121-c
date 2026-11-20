using UnityEngine;

namespace RibbonMeshDemo
{
    /// <summary>
    /// Drops the three demo ribbons into the scene on play start when no
    /// ribbon exists yet. Safe to leave in the scene.
    /// </summary>
    public class RibbonDemoBootstrap : MonoBehaviour
    {
        [SerializeField] private bool spawnOnStart = true;

        private void Start()
        {
#if UNITY_2023_1_OR_NEWER
            bool alreadyExists = FindFirstObjectByType<RibbonMeshComponent>() != null;
#else
            bool alreadyExists = FindObjectOfType<RibbonMeshComponent>() != null;
#endif
            if (spawnOnStart && !alreadyExists)
            {
                RibbonDemoSpawner.CreateAll(transform);
            }
        }
    }
}
