import { lookAt, multiply, perspective, projectPoint, vec3 } from "../src/math.js";

const proj = perspective(Math.PI / 3, 16 / 9, 0.5, 600);
const eye = [0, 5, 0];
const view = lookAt(eye, [0, 3, 10], [0, 1, 0]);
const vp = multiply(proj, view);

// The look target itself sits on the view axis and projects to NDC origin.
const center = [0, 3, 10];
const ahead = projectPoint(vp, center);
console.log("ahead ndc", ahead.map((v) => v.toFixed(3)));
if (!ahead || Math.abs(ahead[0]) > 1e-6 || Math.abs(ahead[1]) > 1e-6) {
  throw new Error("forward point should project to NDC origin");
}

// Point behind the camera must be rejected.
if (projectPoint(vp, [0, 3, -20]) !== null) {
  throw new Error("point behind camera must return null");
}

// Camera looks toward +z, so its right vector is world -x.
const right = projectPoint(vp, vec3.add(center, [5, 0, 0]));
if (!right || right[0] >= 0) throw new Error("world +x should map to screen left while looking +z");

// Taller object has a larger projected vertical extent.
const base = projectPoint(vp, vec3.add(center, [0, -2, 0]));
const top = projectPoint(vp, vec3.add(center, [0, 8, 0]));
const extent = Math.abs(top[1] - base[1]);
if (!(extent > 0)) throw new Error("vertical extent must be positive");

console.log("vertical extent", extent.toFixed(4));
console.log("math pipeline OK");
