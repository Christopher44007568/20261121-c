using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace SSSDemo
{
    // Screen-space subsurface scattering implemented as an HDRP custom pass.
    // Pipeline:
    //   1. SSS materials write direct radiance, material ID and thickness into
    //      three full-screen buffers.
    //   2. A 48-tap horizontal then 48-tap vertical Gaussian diffusion (96-tap
    //      footprint, three lobes) runs on the beauty buffer, gated by ID.
    //   3. The composite pass applies thickness transmission and adds the
    //      scattered energy back on top of the direct lighting.
    public sealed class SSSDiffusionPass : CustomPass
    {
        public enum DebugView { Beauty = 0, MaterialID = 1, Thickness = 2 }

        [Header("Diffusion profile")]
        [Range(0.1f, 8f)] public float radiusScale = 1f;
        public bool sssEnabled = true;
        public bool idGateEnabled = true;
        public DebugView debugView = DebugView.Beauty;

        [Header("Buffers")]
        [Range(0.25f, 1f)] public float bufferScale = 1f;

        private RTHandle beautyRT;
        private RTHandle idRT;
        private RTHandle scratchRT;
        private RTHandle scratchB_RT;
        private Material diffusionMaterial;

        private static readonly int BeautyId = Shader.PropertyToID("_SSSBeautyTex");
        private static readonly int IdTexId = Shader.PropertyToID("_SSSIDTex");
        private static readonly int ThicknessId = Shader.PropertyToID("_SSSThicknessTex");
        private static readonly int DiffuseId = Shader.PropertyToID("_SSSDiffuseTex");
        private static readonly int DepthId = Shader.PropertyToID("_SSSCameraDepthTex");
        private static readonly int RadiusScaleId = Shader.PropertyToID("_SSSRadiusScale");
        private static readonly int EnabledId = Shader.PropertyToID("_SSSEnabled");
        private static readonly int GateId = Shader.PropertyToID("_SSSIDGateEnabled");
        private static readonly int InvHeightId = Shader.PropertyToID("_SSSInvHeight");
        private static readonly int DebugModeId = Shader.PropertyToID("_SSSDebugMode");

        private const string ShaderName = "Hidden/SSSDiffusion";
        private const string BeautyTag = "SSSBeauty";
        private const string IdTag = "SSSIDThickness";

        protected override void Setup(ScriptableRenderContext renderContext, CommandBuffer cmd)
        {
            var shader = Shader.Find(ShaderName);
            if (shader != null)
                diffusionMaterial = CoreUtils.CreateEngineMaterial(shader);

            var format = GraphicsFormat.R16G16B16A16_SFloat;
            beautyRT = RTHandles.Alloc(
                scaleFactor: size => new Vector2Int(Mathf.Max(1, Mathf.RoundToInt(size.x * bufferScale)), Mathf.Max(1, Mathf.RoundToInt(size.y * bufferScale))),
                dimension: TextureXR.dimension,
                colorFormat: format,
                depthBufferBits: DepthBits.None,
                enableRandomWrite: false,
                name: "SSS_Beauty");
            idRT = RTHandles.Alloc(
                scaleFactor: size => new Vector2Int(Mathf.Max(1, Mathf.RoundToInt(size.x * bufferScale)), Mathf.Max(1, Mathf.RoundToInt(size.y * bufferScale))),
                dimension: TextureXR.dimension,
                colorFormat: GraphicsFormat.R8G8B8A8_UNorm,
                depthBufferBits: DepthBits.None,
                name: "SSS_IDThickness");
            scratchRT = RTHandles.Alloc(
                scaleFactor: size => new Vector2Int(Mathf.Max(1, Mathf.RoundToInt(size.x * bufferScale)), Mathf.Max(1, Mathf.RoundToInt(size.y * bufferScale))),
                dimension: TextureXR.dimension,
                colorFormat: format,
                depthBufferBits: DepthBits.None,
                name: "SSS_Scratch");
            scratchB_RT = RTHandles.Alloc(
                scaleFactor: size => new Vector2Int(Mathf.Max(1, Mathf.RoundToInt(size.x * bufferScale)), Mathf.Max(1, Mathf.RoundToInt(size.y * bufferScale))),
                dimension: TextureXR.dimension,
                colorFormat: format,
                depthBufferBits: DepthBits.None,
                name: "SSS_ScratchB");
        }

        protected override void Execute(CustomPassContext ctx)
        {
            if (diffusionMaterial == null)
                return;

            var cmd = ctx.cmd;
            int height = Mathf.Max(1, Mathf.RoundToInt(ctx.hdCamera.actualHeight * bufferScale));

            CoreUtils.SetRenderTarget(cmd, beautyRT, ClearFlag.Color, Color.black);
            var beautyList = CreateRendererList(ctx, BeautyTag);
            if (beautyList.IsValid())
                HDUtils.DrawRendererList(ctx.renderContext, cmd, beautyList);

            CoreUtils.SetRenderTarget(cmd, idRT, ClearFlag.Color, new Color(0, 0, 0, 0));
            var idList = CreateRendererList(ctx, IdTag);
            if (idList.IsValid())
                HDUtils.DrawRendererList(ctx.renderContext, cmd, idList);

            diffusionMaterial.SetTexture(BeautyId, beautyRT);
            diffusionMaterial.SetTexture(IdTexId, idRT);
            diffusionMaterial.SetTexture(ThicknessId, idRT);
            diffusionMaterial.SetTexture(DepthId, ctx.cameraDepthBuffer);
            diffusionMaterial.SetFloat(RadiusScaleId, radiusScale);
            diffusionMaterial.SetFloat(EnabledId, sssEnabled ? 1f : 0f);
            diffusionMaterial.SetFloat(GateId, idGateEnabled ? 1f : 0f);
            diffusionMaterial.SetFloat(InvHeightId, 1f / height);
            diffusionMaterial.SetVector(DebugModeId, new Vector4((float)debugView, 0, 0, 0));

            // Separable diffusion: horizontal into scratch A, vertical into scratch B.
            CoreUtils.SetRenderTarget(cmd, scratchRT, ClearFlag.Color, Color.black);
            CoreUtils.DrawFullScreen(cmd, diffusionMaterial, shaderPassId: 0);
            diffusionMaterial.SetTexture(BeautyId, scratchRT);
            CoreUtils.SetRenderTarget(cmd, scratchB_RT, ClearFlag.Color, Color.black);
            CoreUtils.DrawFullScreen(cmd, diffusionMaterial, shaderPassId: 1);

            // Composite over the HDRP camera color buffer.
            diffusionMaterial.SetTexture(BeautyId, beautyRT);
            diffusionMaterial.SetTexture(DiffuseId, scratchB_RT);
            CoreUtils.SetRenderTarget(cmd, ctx.cameraColorBuffer, ctx.cameraDepthBuffer);
            CoreUtils.DrawFullScreen(cmd, diffusionMaterial, shaderPassId: 2);
        }

        private RendererList CreateRendererList(CustomPassContext ctx, string lightModeTag)
        {
            var result = new RendererListDesc(
                new ShaderTagId[] { new ShaderTagId(lightModeTag) },
                ctx.cullingResults,
                ctx.hdCamera.camera)
            {
                rendererConfiguration = PerObjectData.None,
                renderQueueRange = RenderQueueRange.all,
                sortingCriteria = SortingCriteria.BackToFront,
                excludeObjectMotionVectors = false
            };
            return RendererList.Create(result);
        }

        protected override void Cleanup()
        {
            CoreUtils.Destroy(diffusionMaterial);
            beautyRT?.Release();
            idRT?.Release();
            scratchRT?.Release();
            scratchB_RT?.Release();
        }
    }
}
