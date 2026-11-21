import * as THREE from "three";

const vertexShader = /* glsl */ `
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  void main() {
    mat3 linear = mat3(modelMatrix);
    vec3 c0 = linear[0];
    vec3 c1 = linear[1];
    vec3 c2 = linear[2];
    float det = dot(c0, cross(c1, c2));
    vec3 cofactorNormal =
      cross(c1, c2) * normal.x +
      cross(c2, c0) * normal.y +
      cross(c0, c1) * normal.z;

    // Cofactor / sign(det) is the inverse-transpose direction after normalization.
    // Using sign(det) also works for negative-scaled (mirrored) instances.
    vWorldNormal = normalize(cofactorNormal * sign(det));
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPosition, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uAlbedoMap;
  uniform sampler2D uNormalMap;
  uniform float uTileSize;
  uniform float uNormalStrength;
  uniform float uFlipNormalG;
  uniform float uFlipNormalX;
  uniform vec3 uBlendWeights;
  uniform float uBlendContrast;
  uniform int uViewMode;
  uniform vec3 uLightDirection;
  uniform vec3 uLightColor;
  uniform float uSunIntensity;

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  vec4 sampleTriplanar(sampler2D map, vec3 p, vec3 weights, vec3 faceNormal) {
    vec3 sx = vec3(sign(faceNormal.x), 0.0, 0.0);
    vec3 sy = vec3(0.0, sign(faceNormal.y), 0.0);
    vec3 sz = vec3(0.0, 0.0, sign(faceNormal.z));
    vec2 uvX = vec2(-sx.x * p.z, p.y);
    vec2 uvY = vec2(p.x, -sy.y * p.z);
    vec2 uvZ = vec2(p.x, sz.z * p.y);
    vec4 x = texture2D(map, uvX);
    vec4 y = texture2D(map, uvY);
    vec4 z = texture2D(map, uvZ);
    return x * weights.x + y * weights.y + z * weights.z;
  }

  vec3 getProjectedNormal(vec3 p, vec3 weights, vec3 faceNormal) {
    vec3 nx = texture2D(uNormalMap, vec2(-sign(faceNormal.x) * p.z, p.y)).xyz * 2.0 - 1.0;
    vec3 ny = texture2D(uNormalMap, vec2(p.x, -sign(faceNormal.y) * p.z)).xyz * 2.0 - 1.0;
    vec3 nz = texture2D(uNormalMap, vec2(p.x, sign(faceNormal.z) * p.y)).xyz * 2.0 - 1.0;

    nx.x *= uFlipNormalX;
    ny.x *= uFlipNormalX;
    nz.x *= uFlipNormalX;
    nx.y *= uFlipNormalG;
    ny.y *= uFlipNormalG;
    nz.y *= uFlipNormalG;

    nx.xy *= uNormalStrength;
    ny.xy *= uNormalStrength;
    nz.xy *= uNormalStrength;

    float sx = sign(faceNormal.x);
    float sy = sign(faceNormal.y);
    float sz = sign(faceNormal.z);
    vec3 worldX = vec3(sx * nx.z, nx.y, -sx * nx.x);
    vec3 worldY = vec3(ny.x, sy * ny.z, -sy * ny.y);
    vec3 worldZ = sz > 0.0 ? nz : vec3(nz.x, -nz.y, -nz.z);

    return normalize(
      worldX * weights.x +
      worldY * weights.y +
      worldZ * weights.z
    );
  }

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  vec3 weightMask(vec3 weights) {
    vec3 xColor = vec3(0.87, 0.46, 0.37);
    vec3 yColor = vec3(0.85, 0.72, 0.37);
    vec3 zColor = vec3(0.44, 0.64, 0.74);
    vec3 color = xColor * weights.x + yColor * weights.y + zColor * weights.z;
    vec3 cell = min(fract(vWorldPosition), 1.0 - fract(vWorldPosition));
    float gridDistance = min(cell.x, min(cell.y, cell.z));
    float grid = 1.0 - smoothstep(0.0, 0.025, gridDistance);
    color += vec3(grid * 0.12);
    return color;
  }

  void main() {
    vec3 geometricNormal = normalize(vWorldNormal);

    vec3 axisWeights = pow(abs(geometricNormal), vec3(uBlendContrast));
    axisWeights *= max(uBlendWeights, vec3(0.0));
    float weightSum = axisWeights.x + axisWeights.y + axisWeights.z;
    vec3 weights = weightSum > 0.0001
      ? axisWeights / weightSum
      : vec3(0.333333);

    vec3 p = vWorldPosition / uTileSize;
    vec3 albedo = sampleTriplanar(uAlbedoMap, p, weights, geometricNormal).rgb;
    vec3 normal = getProjectedNormal(p, weights, geometricNormal);

    if (uViewMode == 1) {
      gl_FragColor = vec4(albedo, 1.0);
      #include <colorspace_fragment>
      return;
    }

    if (uViewMode == 2) {
      gl_FragColor = vec4(normal * 0.5 + 0.5, 1.0);
      #include <colorspace_fragment>
      return;
    }

    if (uViewMode == 3) {
      gl_FragColor = vec4(weightMask(weights), 1.0);
      #include <colorspace_fragment>
      return;
    }

    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 lightDirection = normalize(uLightDirection);
    float ndl = max(dot(normal, lightDirection), 0.0);
    float diffuse = mix(0.09, 1.08, ndl);
    float sky = clamp(normal.y * 0.5 + 0.5, 0.0, 1.0);
    float cavity = smoothstep(0.2, 0.9, albedo.g + albedo.r * 0.4);
    vec3 ambient = mix(vec3(0.095, 0.1, 0.09), vec3(0.28, 0.3, 0.25), sky);
    vec3 halfVector = normalize(lightDirection + viewDirection);
    float specular = pow(max(dot(normal, halfVector), 0.0), 38.0) * 0.2;
    float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.5) * 0.14;

    vec3 mossColor = vec3(0.2, 0.255, 0.13);
    float moss = smoothstep(0.58, 0.9, geometricNormal.y) *
      smoothstep(0.42, 0.7, hash12(floor(p.xz * 5.0))) * 0.32;

    vec3 surface = mix(albedo, mossColor, moss);
    vec3 color = surface * (ambient * (0.65 + cavity * 0.35) +
      uLightColor * uSunIntensity * diffuse);
    float bounce = max(dot(normal, normalize(vec3(0.16, -1.0, 0.28))), 0.0);
    color += surface * vec3(0.25, 0.27, 0.23) * bounce;
    color += uLightColor * specular * (0.35 + cavity * 0.65);
    color += vec3(0.42, 0.48, 0.39) * rim;

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createTriplanarMaterial({ albedoMap, normalMap }) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    uniforms: {
      uAlbedoMap: { value: albedoMap },
      uNormalMap: { value: normalMap },
      uTileSize: { value: 1 },
      uNormalStrength: { value: 1 },
      uFlipNormalG: { value: 1 },
      uFlipNormalX: { value: 1 },
      uBlendWeights: { value: new THREE.Vector3(1, 1, 1) },
      uBlendContrast: { value: 6 },
      uViewMode: { value: 0 },
      uLightDirection: { value: new THREE.Vector3(-0.45, 0.62, 0.55).normalize() },
      uLightColor: { value: new THREE.Color("#f4d4a1") },
      uSunIntensity: { value: 1.35 },
    },
  });
}
