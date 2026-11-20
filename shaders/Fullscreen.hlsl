// Procedural full-screen triangle (no vertex buffer). SV_VertexID 0..2 covers
// the viewport once; used by HiZ, SSRResolve, Temporal and Composite passes.
struct FSOut { float4 clip:SV_POSITION; };
FSOut VSMain(uint vid:SV_VertexID){
    FSOut o;
    o.clip.x = (vid==1 ? 3.0f : -1.0f);
    o.clip.y = (vid==2 ? 3.0f : -1.0f);
    o.clip.z = 0.0f; o.clip.w = 1.0f;
    return o;
}
