/** Exact fractions for inheritance shares (never floating point: 1/3 + 1/6 must be 1/2 exactly). */
export class Frac {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint | number, d: bigint | number = 1n) {
    let a = BigInt(n), b = BigInt(d);
    if (b === 0n) throw Error('zero denominator');
    if (b < 0n) { a = -a; b = -b; }
    const g = gcd(a < 0n ? -a : a, b);
    this.n = g ? a / g : a;
    this.d = g ? b / g : b;
  }
  static readonly ZERO = new Frac(0);
  static readonly ONE = new Frac(1);
  add(o: Frac): Frac { return new Frac(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o: Frac): Frac { return new Frac(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o: Frac | number): Frac { const f = typeof o === 'number' ? new Frac(o) : o; return new Frac(this.n * f.n, this.d * f.d); }
  div(o: Frac | number): Frac { const f = typeof o === 'number' ? new Frac(o) : o; return new Frac(this.n * f.d, this.d * f.n); }
  cmp(o: Frac): number { const x = this.n * o.d - o.n * this.d; return x < 0n ? -1 : x > 0n ? 1 : 0; }
  gt(o: Frac): boolean { return this.cmp(o) > 0; }
  lt(o: Frac): boolean { return this.cmp(o) < 0; }
  eq(o: Frac): boolean { return this.cmp(o) === 0; }
  isZero(): boolean { return this.n === 0n; }
  max(o: Frac): Frac { return this.gt(o) ? this : o; }
  min(o: Frac): Frac { return this.lt(o) ? this : o; }
  toNumber(): number { return Number(this.n) / Number(this.d); }
  toString(): string { return this.d === 1n ? String(this.n) : `${this.n}/${this.d}`; }
}

export const f = (n: number, d = 1) => new Frac(n, d);

export function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return a;
}
export function lcm(a: bigint, b: bigint): bigint { return a / gcd(a, b) * b; }
export const sum = (list: Frac[]) => list.reduce((s, x) => s.add(x), Frac.ZERO);
