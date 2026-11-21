// Exact rational arithmetic on BigInt. Fractions are kept reduced with a
// positive denominator so equality comparisons stay canonical.

function gcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a || 1n;
}

export class Q {
  constructor(n, d = 1n) {
    if (d === 0n) throw new Error("rational with zero denominator");
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d);
    this.n = n / g;
    this.d = d / g;
  }

  static of(n) {
    return new Q(BigInt(n));
  }

  add(o) {
    return new Q(this.n * o.d + o.n * this.d, this.d * o.d);
  }

  sub(o) {
    return new Q(this.n * o.d - o.n * this.d, this.d * o.d);
  }

  mul(o) {
    return new Q(this.n * o.n, this.d * o.d);
  }

  neg() {
    return new Q(-this.n, this.d);
  }

  cmp(o) {
    const l = this.n * o.d;
    const r = o.n * this.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }

  equals(o) {
    return this.n === o.n && this.d === o.d;
  }

  isZero() {
    return this.n === 0n;
  }

  toNumber() {
    return Number(this.n) / Number(this.d);
  }

  toString() {
    return this.d === 1n ? `${this.n}` : `${this.n}/${this.d}`;
  }
}

export const q = (n, d) => new Q(BigInt(n), BigInt(d));

// Cross product of vectors (b-a) x (c-a), all coordinates rational.
export function cross(a, b, c) {
  const ux = b.x.sub(a.x);
  const uy = b.y.sub(a.y);
  const vx = c.x.sub(a.x);
  const vy = c.y.sub(a.y);
  return ux.mul(vy).sub(uy.mul(vx));
}
