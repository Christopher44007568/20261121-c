// Decode IEEE-754 half-precision (float16) words into Float32 values.
// rgba16float textures read back as raw 16-bit texels, not float32.

function decodeHalf(word) {
  const sign = (word & 0x8000) >> 15;
  const exponent = (word & 0x7c00) >> 10;
  const fraction = word & 0x03ff;
  const signScale = sign ? -1 : 1;
  if (exponent === 0) {
    return signScale * Math.pow(2, -14) * (fraction / 1024);
  }
  if (exponent === 31) {
    return fraction === 0 ? signScale * Infinity : NaN;
  }
  return signScale * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
}

function decodeHalfBuffer(uint16View) {
  const out = new Float32Array(uint16View.length);
  for (let i = 0; i < uint16View.length; i += 1) {
    out[i] = decodeHalf(uint16View[i]);
  }
  return out;
}

module.exports = { decodeHalf, decodeHalfBuffer };
