# HLSL sources are compiled at runtime via D3DCompileFromFile so the demo can
# hot-tweak SSR parameters. Deploy this folder next to the working directory.
set(SSR_SHADERS
    shaders/Common.hlsli
    shaders/SSR.hlsli
    shaders/Fullscreen.hlsl
    shaders/GBuffer.hlsl
    shaders/HiZ.hlsl
    shaders/SSRResolve.hlsl
    shaders/Temporal.hlsl
    shaders/Composite.hlsl
    shaders/Sky.hlsl)
add_custom_target(SsrShaders SOURCES ${SSR_SHADERS})
