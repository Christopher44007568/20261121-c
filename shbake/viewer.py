"""Emit a single self-contained, fully offline WebGL2 SH sphere viewer.

The generated HTML embeds the SH coefficient JSON and all shaders; there are
no external scripts, fonts, or network requests.  A per-fragment shader
evaluates the same 3-band real SH basis used by the Python baker and shades
an unlit sphere, so what you see is the truncated SH reconstruction itself.
"""

import json


def build_viewer(payload):
    data_json = json.dumps(payload)
    return _TEMPLATE.replace("__SH_DATA__", data_json)


_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>shbake — 3-band SH sphere viewer</title>
<style>
  html,body{margin:0;height:100%;background:#101216;color:#d8dee9;font-family:monospace;overflow:hidden}
  #gl{width:100vw;height:100vh;display:block;cursor:grab}
  #gl:active{cursor:grabbing}
  #panel{position:fixed;top:12px;left:12px;background:rgba(20,23,30,.88);
         border:1px solid #2e3440;border-radius:8px;padding:12px 14px;max-width:330px;font-size:12px}
  #panel h1{font-size:13px;margin:0 0 8px}
  .row{margin:5px 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  button{background:#2e3440;color:#eceff4;border:0;border-radius:5px;padding:5px 9px;cursor:pointer;font-family:monospace}
  button:hover{background:#3b4252}
  table{border-collapse:collapse;margin-top:6px}
  td{padding:1px 8px 1px 0;white-space:nowrap}
  #hint{position:fixed;bottom:10px;left:12px;font-size:11px;opacity:.7}
</style>
</head>
<body>
<canvas id="gl"></canvas>
<div id="panel">
  <h1>3-band spherical harmonics viewer</h1>
  <div class="row">
    <button id="reset">reset view</button>
    <label><input type="checkbox" id="wire"> wireframe</label>
    <label><input type="checkbox" id="grid" checked> axes/grid</label>
  </div>
  <div class="row">exposure
    <input type="range" id="exp" min="-2" max="2" step="0.05" value="0">
  </div>
  <div id="coefs"></div>
</div>
<div id="hint">drag to orbit &middot; wheel to zoom &middot; shading = reconstructed SH radiance</div>
<script>
"use strict";
const PAYLOAD = __SH_DATA__;
const C = PAYLOAD.coefficients_rgb; // 3 x 9
const canvas = document.getElementById("gl");
const gl = canvas.getContext("webgl2", {antialias:true});
if(!gl){ document.body.innerHTML = "WebGL2 is required."; }

const VERT = `#version 300 es
precision highp float;
in vec3 aPos;
uniform mat4 uMVP;
out vec3 vNormal;
void main(){
  vNormal = normalize(aPos);
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

// Same basis constants/order as shbake/sh.py (real SH, Condon-Shortley, z-up).
const FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
out vec4 outColor;
uniform vec3 uC[9];
uniform float uExposure;
void main(){
  vec3 d = normalize(vNormal);
  float x=d.x, y=d.y, z=d.z;
  float x2=x*x, y2=y*y, z2=z*z;
  float b[9];
  b[0]=0.28209479177387814;
  b[1]=0.4886025119029199*y;
  b[2]=0.4886025119029199*z;
  b[3]=0.4886025119029199*x;
  b[4]=1.0925484305920792*x*y;
  b[5]=1.0925484305920792*y*z;
  b[6]=0.31539156525252005*(3.0*z2-1.0);
  b[7]=1.0925484305920792*x*z;
  b[8]=0.5462742152960396*(x2-y2);
  vec3 color = vec3(0.0);
  for(int i=0;i<9;i++){ color += uC[i]*b[i]; }
  color *= exp2(uExposure);
  color = color/(color+vec3(1.0));     // Reinhard, keeps negatives visible
  color = pow(max(color,0.0), vec3(1.0/2.2));
  outColor = vec4(color, 1.0);
}`;

function compile(type, src){
  const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const prog=gl.createProgram();
gl.attachShader(prog,compile(gl.VERTEX_SHADER,VERT));
gl.attachShader(prog,compile(gl.FRAGMENT_SHADER,FRAG));
gl.linkProgram(prog);
if(!gl.getProgramParameter(prog,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);

// UV sphere geometry.
function sphere(seg, rings){
  const pos=[], idx=[], lines=[];
  for(let r=0;r<=rings;r++){
    const theta=Math.PI*r/rings, st=Math.sin(theta), ct=Math.cos(theta);
    for(let s=0;s<=seg;s++){
      const phi=2*Math.PI*s/seg;
      pos.push(st*Math.cos(phi), st*Math.sin(phi), ct);
    }
  }
  for(let r=0;r<rings;r++)for(let s=0;s<seg;s++){
    const a=r*(seg+1)+s, b=a+seg+1;
    idx.push(a,b,a+1, b,b+1,a+1);
    lines.push(a,b, b,a+1, a+1,b+1, b,b+1);
  }
  return {pos:new Float32Array(pos), idx:new Uint16Array(idx),
          lines:new Uint16Array(lines)};
}
const mesh=sphere(96,64);
const vao=gl.createVertexArray(); gl.bindVertexArray(vao);
const vbo=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,vbo);
gl.bufferData(gl.ARRAY_BUFFER,mesh.pos,gl.STATIC_DRAW);
const loc=gl.getAttribLocation(prog,"aPos");
gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);
const ebo=gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ebo);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,mesh.idx,gl.STATIC_DRAW);
const lineEbo=gl.createBuffer();

// uniform coefficient array: uC[i] = rgb vector of basis i.
const uC=gl.getUniformLocation(prog,"uC");
const arr=new Float32Array(27);
for(let i=0;i<9;i++)for(let ch=0;ch<3;ch++) arr[i*3+ch]=C[ch][i];
gl.uniform3fv(uC,arr);
const uMVP=gl.getUniformLocation(prog,"uMVP");
const uExp=gl.getUniformLocation(prog,"uExposure");

// Minimal matrix helpers (column-major), z-up orbit camera.
function perspective(fov,aspect,n,f){
  const t=1/Math.tan(fov/2), o=new Float32Array(16);
  o[0]=t/aspect;o[5]=t;o[10]=(f+n)/(n-f);o[11]=-1;o[14]=(2*f*n)/(n-f);
  return o;
}
function mul(a,b){const o=new Float32Array(16);
  for(let c=0;c<4;c++)for(let r=0;r<4;r++){
    o[c*4+r]=a[0*4+r]*b[c*4+0]+a[1*4+r]*b[c*4+1]+a[2*4+r]*b[c*4+2]+a[3*4+r]*b[c*4+3];}
  return o;}
function translate(x,y,z){const o=new Float32Array(16);o[0]=o[5]=o[10]=o[15]=1;o[12]=x;o[13]=y;o[14]=z;return o;}
function rotX(a){const c=Math.cos(a),s=Math.sin(a),o=new Float32Array(16);
  o[0]=1;o[5]=c;o[6]=s;o[9]=-s;o[10]=c;o[15]=1;return o;}
function rotY(a){const c=Math.cos(a),s=Math.sin(a),o=new Float32Array(16);
  o[0]=c;o[2]=-s;o[8]=s;o[10]=c;o[5]=1;o[15]=1;return o;}

let yaw=0.6, pitch=-0.35, dist=3.2, wire=false, showGrid=true;
function resize(){const dpr=Math.min(devicePixelRatio,2);
  canvas.width=innerWidth*dpr; canvas.height=innerHeight*dpr;
  gl.viewport(0,0,canvas.width,canvas.height);}
addEventListener("resize",resize); resize();

let dragging=false,px=0,py=0;
canvas.addEventListener("pointerdown",e=>{dragging=true;px=e.clientX;py=e.clientY;canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener("pointerup",()=>dragging=false);
canvas.addEventListener("pointermove",e=>{if(!dragging)return;
  yaw+=(e.clientX-px)*0.01; pitch+=(e.clientY-py)*0.01;
  pitch=Math.max(-1.5,Math.min(1.5,pitch)); px=e.clientX;py=e.clientY;});
canvas.addEventListener("wheel",e=>{dist=Math.max(1.6,Math.min(8,dist+e.deltaY*0.002));},{passive:true});
document.getElementById("reset").onclick=()=>{yaw=0.6;pitch=-0.35;dist=3.2;};
document.getElementById("wire").onchange=e=>wire=e.target.checked;
document.getElementById("grid").onchange=e=>showGrid=e.target.checked;
document.getElementById("exp").oninput=e=>gl.uniform1f(uExp,parseFloat(e.target.value));

// coefficient readout
const names=["Y00","Y1-1","Y10","Y11","Y2-2","Y2-1","Y20","Y21","Y22"];
let html="<table><tr><td>basis</td><td>R</td><td>G</td><td>B</td></tr>";
for(let i=0;i<9;i++)html+=`<tr><td>${names[i]}</td><td>${C[0][i].toFixed(4)}</td><td>${C[1][i].toFixed(4)}</td><td>${C[2][i].toFixed(4)}</td></tr>`;
document.getElementById("coefs").innerHTML=html+"</table>";

function frame(){
  gl.clearColor(0.06,0.07,0.09,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  const aspect=canvas.width/canvas.height;
  const proj=perspective(Math.PI/4,aspect,0.1,100);
  const view=translate(0,0,-dist);
  const model=mul(rotY(yaw),rotX(pitch));
  const mvp=mul(prog,mul(view,model));
  gl.uniformMatrix4fv(uMVP,false,mvp);
  gl.uniform1f(uExp,parseFloat(document.getElementById("exp").value));
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, wire ? lineEbo : ebo);
  if(wire){
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,mesh.lines,gl.DYNAMIC_DRAW);
    gl.drawElements(gl.LINES,mesh.lines.length,gl.UNSIGNED_SHORT,0);
  }else{
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,mesh.idx,gl.STATIC_DRAW);
    gl.drawElements(gl.TRIANGLES,mesh.idx.length,gl.UNSIGNED_SHORT,0);
  }
  requestAnimationFrame(frame);
}
frame();
</script>
</body>
</html>
"""
