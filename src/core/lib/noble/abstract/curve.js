/**
 * Methods for elliptic curve multiplication by scalars.
 * Contains wNAF-based ScalarMultiplier, pippenger.
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
import { aarray, abool, afunction, aobject, bitLen, bitMask, bytesToNumberBE, inRange, isBytes, isPosBig, validateObject, } from "../utils.js";
import { Field, FpInvertBatch, validateField } from "./modular.js";
const _0n = /* @__PURE__ */ BigInt(0);
const _1n = /* @__PURE__ */ BigInt(1);
const _4n = /* @__PURE__ */ BigInt(4);
const BLIND_BYTES = 16;
const BLIND_BITS = 128;
// Fixed-window width for the constant-time multiply of un-precomputed points (W===1).
// A flat 2^FW_WINDOW table has a small, scalar-independent build cost that amortizes over a single
// multiply, unlike the larger per-point wNAF tables that only pay off when cached.
const FW_WINDOW = 5;
// Precompute tables are capped at ~2 GiB of estimated heap. Rejecting larger windows up front
// turns a typo'd window size into an immediate error instead of a multi-GB allocation (or an
// effective hang) when the lazy table is built on first multiply.
const TABLE_BYTES_MAX = /* @__PURE__ */ (() => 2 ** 31)();
/**
 * Validates the static surface of a point constructor.
 * This is only a cheap sanity check for the constructor hooks and fields consumed by generic
 * factories; it does not certify `BASE`/`ZERO` semantics or prove the curve implementation itself.
 * @param Point - Runtime point constructor.
 * @throws On missing constructor hooks or malformed field metadata. {@link TypeError}
 * @example
 * Check that one point constructor exposes the static hooks generic helpers need.
 *
 * ```ts
 * import { ed25519 } from '@noble/curves/ed25519.js';
 * import { validatePointCons } from '@noble/curves/abstract/curve.js';
 * validatePointCons(ed25519.Point);
 * ```
 */
export function validatePointCons(Point) {
    const pc = Point;
    if (typeof pc !== 'function')
        throw new TypeError('"Point" expected constructor, got type=' + typeof Point);
    afunction(pc.fromAffine, 'Point.fromAffine');
    afunction(pc.fromBytes, 'Point.fromBytes');
    afunction(pc.fromHex, 'Point.fromHex');
    // Generic helpers (ScalarMultiplier, normalizeZ, MSM) dereference BASE / ZERO:
    // fail here with a typed error instead of an `undefined` access later.
    aobject(pc.BASE, 'Point.BASE');
    aobject(pc.ZERO, 'Point.ZERO');
    validateField(pc.Fp);
    validateField(pc.Fn);
}
/**
 * Takes a bunch of Projective Points but executes only one
 * inversion on all of them. Inversion is very slow operation,
 * so this improves performance massively.
 * Optimization: converts a list of projective points to a list of identical points with Z=1.
 * Input points are left unchanged; the normalized points are returned as fresh instances.
 * @param c - Point constructor.
 * @param points - Projective points.
 * @returns Fresh projective points reconstructed from normalized affine coordinates.
 * @example
 * Batch-normalize projective points with a single shared inversion.
 *
 * ```ts
 * import { normalizeZ } from '@noble/curves/abstract/curve.js';
 * import { p256 } from '@noble/curves/nist.js';
 * const points = normalizeZ(p256.Point, [p256.Point.BASE, p256.Point.BASE.double()]);
 * ```
 */
export function normalizeZ(c, points) {
    // Match MSM helpers: reject malformed public inputs before reading projective internals.
    validatePointCons(c);
    validateMSMPoints(points, c);
    // Identity points (Z=0) rely on an implicit contract: FpInvertBatch without `passZero`
    // yields `undefined` for zero inputs, and `toAffine(undefined)` falls back to its internal
    // is0 handling instead of using the batch inverse.
    const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
    return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW(W, bits, min = 1) {
    if (!Number.isSafeInteger(W) || W < min || W > bits)
        throw new Error('invalid window size, expected [' + min + '..' + bits + '], got W=' + W);
}
// Rough per-point heap estimate for the {@link TABLE_BYTES_MAX} cap: up to 4 projective/extended
// coordinates of Fp.BYTES each, plus bigint/object overhead. Callers pass the point count of the
// largest table the checked parameters can produce.
function validateTableBytes(numPoints, fpBytes) {
    const bytes = numPoints * (4 * fpBytes + 128);
    if (bytes > TABLE_BYTES_MAX)
        throw new Error('invalid window size: table would need ~' +
            Math.ceil(bytes / 2 ** 20) +
            ' MiB, max ' +
            TABLE_BYTES_MAX / 2 ** 20 +
            ' MiB');
}
/**
 * Probes an RNG once, at construction time: returns `undefined` when it is unavailable —
 * throws or returns malformed bytes — so callers can downgrade to their unblinded /
 * deterministic constant-time fallback. Blinding is defense-in-depth (DPA/template
 * hardening), not a correctness or key-secrecy requirement, so availability-based
 * downgrade is acceptable.
 *
 * The downgrade decision is deliberately static. After a successful probe the RNG becomes
 * part of the trusted contract: later misbehavior must fail closed in per-call validation
 * (throw), never downgrade — a dynamic fallback would let a tampered RNG silently strip
 * blinding on demand. A probe can only ever classify broken environments, not adversarial
 * RNGs: a stateful RNG can always behave while probed and misbehave later.
 * @param randomBytes - RNG to probe, or `undefined` when the environment provides none.
 * @param length - Byte length requested from the probe call.
 * @returns The RNG when the probe produced `length` valid bytes; `undefined` otherwise.
 * @example
 * Probe an RNG once before enabling scalar blinding.
 *
 * ```ts
 * import { probeRandomBytes } from '@noble/curves/abstract/curve.js';
 * import { randomBytes } from '../hashes/utils.js';
 * const rng = probeRandomBytes(randomBytes, 16);
 * ```
 */
export function probeRandomBytes(randomBytes, length) {
    if (randomBytes === undefined)
        return undefined;
    afunction(randomBytes, 'randomBytes');
    try {
        const probe = randomBytes(length);
        if (!isBytes(probe) || probe.length !== length)
            return undefined;
    }
    catch {
        return undefined;
    }
    return randomBytes;
}
function validateMSMPoints(points, c) {
    aarray(points, 'points');
    points.forEach((p, i) => {
        if (!(p instanceof c))
            throw new Error('invalid point at index ' + i);
    });
}
// Default bound is field membership (0 <= s < field.ORDER); a `maxScalar` override widens it
// to 0 <= s < maxScalar for callers that accept oversized scalars.
function validateMSMScalars(scalars, field, maxScalar) {
    if (!Array.isArray(scalars))
        throw new Error('array of scalars expected');
    scalars.forEach((s, i) => {
        const ok = maxScalar === undefined ? field.isValid(s) : isPosBig(s) && s < maxScalar;
        if (!ok)
            throw new Error('invalid scalar at index ' + i);
    });
}
const pointWindowSizes = new WeakMap();
function getWindowSize(P) {
    // `1` is the uncached sentinel: use the non-precomputed (wNAF / fixed-window) path.
    return pointWindowSizes.get(P) || 1;
}
/** Table of odd multiples [1P, 3P, ..., (2⋅size−1)P]; width-W wNAF uses size = 2^(W−2). */
function oddMultiples(p, size) {
    const dbl = p.double();
    const t = [p];
    for (let j = 1; j < size; j++)
        t.push(t[j - 1].add(dbl));
    return t;
}
/**
 * Width-W wNAF signed-digit recoding (W >= 2), LSB-first: digits are 0 or odd with
 * |digit| < 2^(W−1); nonzero density ~1/(W+1) (a nonzero digit is followed by W−1 zeros).
 */
function wnafDigits(n, W) {
    const size = 2 ** W;
    const half = size / 2;
    const mask = BigInt(size - 1);
    const d = [];
    while (n > _0n) {
        let w = 0;
        if (n & _1n) {
            w = Number(n & mask); // n mod 2^W, odd
            if (w >= half)
                w -= size; // signed residue
            n -= BigInt(w); // n - w ≡ 0 mod 2^W: next W−1 digits are zero
        }
        d.push(w);
        n >>= _1n;
    }
    return d;
}
/**
 * Fixed-position signed-window recoding for precomputed wNAF: `n = Σ digits[w]⋅2^(w⋅W)` with
 * digits in `[−2^(W−1)+1, 2^(W−1)]`. Digit count is fixed by `windows` (callers reserve one
 * extra window for the final carry), so recoding length does not depend on the scalar.
 */
function signedWindowDigits(n, W, windows) {
    const size = 2 ** W;
    const half = size / 2;
    const mask = BigInt(size - 1);
    const shiftBy = BigInt(W);
    const d = [];
    for (let w = 0; w < windows; w++) {
        let v = Number(n & mask);
        n >>= shiftBy;
        if (v > half) {
            v -= size; // negative digit, carry into the next window
            n += _1n;
        }
        d.push(v);
    }
    // Internal invariant: leftover bits mean the window count did not cover the scalar.
    if (n !== _0n)
        throw new Error('invalid wnaf');
    return d;
}
/**
 * Shared vartime walk over per-scalar wNAF digit streams: one doubling of a single shared
 * accumulator per bit position of the longest recoding, one signed table addition per
 * nonzero digit. `tables[i]` must hold the odd multiples of the i-th point.
 */
function wnafWalk(zero, tables, digits) {
    let max = 0;
    for (const d of digits)
        max = Math.max(max, d.length);
    let acc = zero;
    for (let bit = max - 1; bit >= 0; bit--) {
        if (bit !== max - 1)
            acc = acc.double();
        for (let i = 0; i < digits.length; i++) {
            const w = digits[i][bit]; // reads past shorter recodings yield undefined, skipped below
            if (w) {
                const item = tables[i][(Math.abs(w) - 1) >> 1];
                acc = acc.add(w < 0 ? item.negate() : item);
            }
        }
    }
    return acc;
}
/**
 * Elliptic curve multiplication of Point by scalar.
 * Routes between cached-table, fixed-window, and one-shot wNAF paths; entry points validate
 * their own scalars (`mulCT`/`mulCTBlinded`: `1 <= s < Fn.ORDER`; `mulUnsafe`: up to the
 * `Fn.ORDER^4` DoS cap via {@link mulAddUnsafe}).
 * Table generation is expensive and happens on first call of `multiply()`
 * (or eagerly via `precompute(W, false)`). By default, `BASE` point is precomputed.
 *
 * Cached algorithm is signed fixed-window wNAF:
 * - table stores, for every window w, the multiples `[1..2^(W−1)]⋅2^(w⋅W)⋅P` — all doublings
 *   are baked in, so a multiplication is exactly one table addition per window
 * - window count is fixed (`ceil(bits/W) + 1`), so the point-operation count is scalar-independent
 *   (basis of the constant-time path)
 * - for a 256-bit curve and W=6: 44⋅32 = 1408 table points, 44 additions per multiply
 * - secret scalars are additionally blinded (see {@link ScalarMultiplier.mulCTBlinded}), which
 *   widens tables by 128 bits
 * @param Point - Point constructor.
 * @param randomBytes - RNG used for scalar blinding; required by the blinded secret path.
 * @example
 * Elliptic curve multiplication of Point by scalar.
 *
 * ```ts
 * import { ScalarMultiplier } from '@noble/curves/abstract/curve.js';
 * import { p256 } from '@noble/curves/nist.js';
 * const mul = new ScalarMultiplier(p256.Point);
 * ```
 */
export class ScalarMultiplier {
    Point;
    BASE;
    ZERO;
    randomBytes;
    wnafPrecomputes = new WeakMap();
    baseCanBeBlinded;
    bits;
    // Parametrized with a given Point class (not individual point)
    constructor(Point, randomBytes) {
        validatePointCons(Point);
        // Probe the RNG once (see {@link probeRandomBytes}): in environments without working
        // randomness (e.g. no WebCrypto), shouldBlind() then routes secret multiplication to the
        // unblinded constant-time path instead of throwing on every multiply(). The shape of
        // returned bytes is still validated on every blinded call, where breakage fails closed.
        this.randomBytes = probeRandomBytes(randomBytes, BLIND_BYTES);
        this.Point = Point;
        this.BASE = Point.BASE;
        this.ZERO = Point.ZERO;
        this.bits = Point.Fn.BITS;
    }
    /**
     * Creates a signed fixed-window wNAF precomputation table: for every window w, the
     * multiples `[1..2^(W−1)]⋅2^(w⋅W)⋅P`, flattened. All doublings are baked into the table,
     * so cached multiplication is additions-only. `windows = ceil(bits/W) + 1`: the extra
     * window absorbs the final carry of signed-digit recoding.
     * For a 256-bit curve and W=6, the table is 44⋅32 = 1408 points.
     * @param point - Point instance
     * @param W - window size
     * @param bits - scalar bitlength the table must cover
     */
    buildWnafTable(point, W, bits) {
        // W needs no re-validation: its only source is setWindowSize(), which enforces
        // 1 <= W <= Fn.BITS <= bits (the blinded path only ever widens bits) and caps the
        // resulting table at ~2 GiB (sized against the wider blinded layout).
        const windows = Math.ceil(bits / W) + 1;
        const half = 2 ** (W - 1);
        const comp = [];
        let base = point;
        for (let w = 0; w < windows; w++) {
            let acc = base;
            for (let i = 0; i < half; i++) {
                comp.push(acc);
                acc = acc.add(base);
            }
            base = comp[comp.length - 1].double(); // 2⋅(2^(W−1)⋅base) = next window's base
        }
        return { W, bits, windows, comp };
    }
    /**
     * Implements ec multiplication using precomputed signed fixed-window wNAF tables.
     * Constant-time: fixed window count with one table addition per window — zero digits feed
     * the fake accumulator — and no doublings; the lookup scans the whole window slice.
     * Scalar bounds are validated by the public entry points ({@link ScalarMultiplier.mulCT},
     * {@link ScalarMultiplier.mulCTBlinded}, {@link ScalarMultiplier.mulUnsafe});
     * signedWindowDigits throws if `n` exceeds the table.
     * @returns real and fake (for const-time) points
     */
    wnafCachedCT(precomputes, n) {
        const { W, windows, comp } = precomputes;
        const half = 2 ** (W - 1);
        const digits = signedWindowDigits(n, W, windows);
        let p = this.ZERO;
        let f = this.BASE;
        for (let w = 0; w < windows; w++) {
            const digit = digits[w];
            const start = w * half;
            // Data-oblivious select: touch every entry of the window before the digit branch.
            const idx = Math.abs(digit) - 1; // -1 for zero digits: matches nothing, `sel` unused
            let sel = comp[start];
            for (let i = 1; i < half; i++)
                sel = i === idx ? comp[start + i] : sel;
            const neg = sel.negate(); // compute both signs; the digit only picks one
            if (digit === 0)
                f = f.add(comp[start]);
            else
                p = p.add(digit < 0 ? neg : sel);
        }
        return { p, f };
    }
    // Cache key is point identity plus (W, bits); at most two entries exist per point (public-width
    // `Fn.BITS` and blinded `Fn.BITS + BLIND_BITS`). Callers must not reuse the same point with
    // incompatible `transform(...)` layouts and expect a separate cache entry.
    getWnafPrecomputes(W, point, bits, transform) {
        let entries = this.wnafPrecomputes.get(point);
        let comp = entries?.find((entry) => entry.W === W && entry.bits === bits);
        if (!comp) {
            comp = this.buildWnafTable(point, W, bits);
            if (typeof transform === 'function')
                comp = { ...comp, comp: transform(comp.comp) };
            if (!entries) {
                entries = [];
                this.wnafPrecomputes.set(point, entries);
            }
            entries.push(comp);
        }
        return comp;
    }
    assertPoint(point) {
        if (!(point instanceof this.Point))
            throw new TypeError('"point" expected Point instance, got type=' + typeof point);
    }
    // Shared prologue of the constant-time entry points. Rejects scalar 0: in key/signature-style
    // callers a zero scalar means broken upstream plumbing, and concrete Points already reject it.
    // Uses inRange instead of Fn.isValidNot0: validateField() only certifies the arithmetic subset.
    validateMulInput(point, scalar) {
        this.assertPoint(point);
        if (!inRange(scalar, _1n, this.Point.Fn.ORDER))
            throw new Error('invalid scalar');
    }
    // Constant-time dispatch shared by mulCT / mulCTBlinded. Un-precomputed points (W===1, e.g.
    // ECDH peer keys) skip building a throwaway cached table in favor of a small fixed-window
    // multiply. `n` must be < 2^bits.
    runCT(point, n, bits, transform) {
        const W = getWindowSize(point);
        if (W === 1)
            return this.fixedWindowCT(point, n, bits);
        return this.wnafCachedCT(this.getWnafPrecomputes(W, point, bits, transform), n);
    }
    mulCT(point, scalar, transform) {
        this.validateMulInput(point, scalar);
        return this.runCT(point, scalar, this.bits, transform);
    }
    mulCTBlinded(point, scalar, transform) {
        this.validateMulInput(point, scalar);
        // Blinding computes n = scalar + blind*Fn.ORDER, then n*P via a constant-time multiply. This
        // equals scalar*P only when Fn.ORDER*P == O; callers guarantee that via shouldBlind() (always
        // for cofactor-1 curves; for cofactored curves only BASE, and only after checking BASE*n == O).
        // Fail before building the (large) precompute table if randomness is unavailable.
        if (this.randomBytes === undefined)
            throw new Error('randomBytes is required for scalar blinding');
        const bits = this.Point.Fn.BITS + BLIND_BITS;
        const blind = this.randomBytes(BLIND_BYTES);
        if (!isBytes(blind) || blind.length !== BLIND_BYTES)
            throw new Error('randomBytes returned invalid byte array');
        // Force the top two bits of the 128-bit blind to 10xxxxxx, so blind is in [2^127, 1.5*2^127):
        // * `| 0x80` (bit 127 = 1) is the load-bearing part: it guarantees blind >= 2^127, so the blind
        //   is always a full-width, nonzero factor and the scalar is masked even with a degenerate RNG.
        // * `& 0x3f` (bit 126 = 0) is a safety margin: it caps blind < 1.5*2^127, keeping
        //   blind*Fn.ORDER + scalar < 0.75*2^(nBits+128), i.e. ~half a window below the 2^(nBits+128)
        //   ceiling. Not strictly required for the bound (see below), but it reserves headroom so the
        //   guarantee does not rest on the tight `Fn.ORDER < 2^Fn.BITS` fact and the final carry window
        //   only ever holds a small carry, never a full digit.
        blind[0] = (blind[0] & 0x3f) | 0x80;
        // Even at the extreme (blind < 2^128, scalar < Fn.ORDER < 2^nBits): n <= 2^128*Fn.ORDER - 1 <
        // 2^(nBits+128), so n stays below 2^bits and within the blinded table's
        // window count. Both cached CT kernels run a fixed number of windows/rows with one point-add
        // each, so the add count is independent of scalar (constant-time).
        const n = scalar + bytesToNumberBE(blind) * this.Point.Fn.ORDER;
        return this.runCT(point, n, bits, transform);
    }
    /**
     * Constant-time multiplication `n*point` for an un-precomputed point, via a small fixed window.
     * A cached wNAF table only pays off when reused; a flat 2^FW_WINDOW table (`size-1` adds) is
     * far cheaper to build for a single use. The point-operation sequence is independent of `n`:
     * build the table, then per window exactly FW_WINDOW doublings, a data-oblivious scan over
     * every table entry, and one addition (adds the identity when the window digit is 0 — never
     * skipped).
     *
     * `n` must be `< 2^bits`. Assumes complete addition (adding the identity costs the same as any
     * add), which holds for the Weierstrass/Edwards point types used here. The table is left in
     * projective form (no normalizeZ): normalizing this small a table costs more than the
     * mixed-add savings it would buy for a single multiply.
     * @returns real point `p`; `f` duplicates it only to match {@link wnafCachedCT}'s return shape
     * (this path needs no fake accumulator — its op-count is already scalar-independent).
     */
    fixedWindowCT(point, n, bits) {
        const W = FW_WINDOW;
        const size = 1 << W;
        const mask = bitMask(W);
        // Flat table [O, point, 2*point, ..., (size-1)*point].
        const table = new Array(size);
        table[0] = this.ZERO;
        for (let i = 1; i < size; i++)
            table[i] = table[i - 1].add(point);
        // Horner MSB->LSB. windows*W >= bits and n < 2^bits, so every bit of n is consumed.
        const windows = Math.ceil(bits / W);
        let acc = this.ZERO;
        for (let window = windows - 1; window >= 0; window--) {
            // W doublings per window; skipped for the first (topmost) window, where acc is still the
            // identity. The skip is scalar-independent: it depends only on the loop index.
            if (window !== windows - 1)
                for (let d = 0; d < W; d++)
                    acc = acc.double();
            const digit = Number((n >> BigInt(window * W)) & mask);
            // Data-oblivious select: touch every entry, same as wnafCachedCT.
            let sel = table[0];
            for (let i = 1; i < size; i++)
                sel = i === digit ? table[i] : sel;
            acc = acc.add(sel); // one add per window, even for digit 0
        }
        return { p: acc, f: acc };
    }
    shouldBlind(point, cofactor) {
        // No usable RNG (probed in the constructor): blinding is impossible, use the plain CT path.
        if (this.randomBytes === undefined)
            return false;
        if (cofactor === _1n)
            return true;
        if (point !== this.BASE)
            return false;
        if (this.baseCanBeBlinded === undefined)
            this.baseCanBeBlinded = this.mulUnsafe(this.BASE, this.Point.Fn.ORDER).is0();
        return this.baseCanBeBlinded;
    }
    mulSecret(point, scalar, cofactor, transform) {
        return this.shouldBlind(point, cofactor)
            ? this.mulCTBlinded(point, scalar, transform)
            : this.mulCT(point, scalar, transform);
    }
    mulUnsafe(point, scalar, transform) {
        this.assertPoint(point);
        if (!isPosBig(scalar))
            throw new Error('invalid scalar');
        const W = getWindowSize(point);
        // W === 1 (un-precomputed): one-shot width-4 wNAF via {@link mulAddUnsafe} with L=1 —
        // a cached table would be thrown away after one use. `allowOversized` swaps the
        // `s < Fn.ORDER` check for mulAddUnsafe's `Fn.ORDER^4` DoS cap.
        //
        // Oversized scalar could happen when:
        // a) user passes large scalar on their own (rare)
        // b) `assertValidity()` calls `isTorsionFree()`, which multiplies point by `Fn.ORDER`
        if (W === 1 || scalar >= this.Point.Fn.ORDER)
            return mulAddUnsafe(this.Point, [point], [scalar], true);
        // Precomputed points reuse the CT kernel (fake accumulator discarded): with W=6 only
        // ~1/64 of window-adds are skippable, so a dedicated vartime kernel saved just ~6% on
        // this path while doubling the cached-table code surface.
        const precomputes = this.getWnafPrecomputes(W, point, this.bits, transform);
        return this.wnafCachedCT(precomputes, scalar).p;
    }
    // Remembers the window size used for precomputed wNAF multiplication of the given point
    // and drops any previously built tables. Usually only the base point is precomputed.
    // W=1 resets the point to the un-precomputed (table-less) paths.
    // W is additionally capped so tables stay under ~2 GiB ({@link TABLE_BYTES_MAX}).
    setWindowSize(point, W) {
        this.assertPoint(point);
        validateW(W, this.bits);
        // Size against the widest table this W can produce: the blinded path adds BLIND_BITS.
        const windows = Math.ceil((this.bits + BLIND_BITS) / W) + 1;
        validateTableBytes(windows * 2 ** (W - 1), this.Point.Fp.BYTES);
        pointWindowSizes.set(point, W);
        this.wnafPrecomputes.delete(point);
    }
    // True when a window size is set: tables themselves are built lazily on first multiply.
    hasWindowSize(point) {
        return getWindowSize(point) !== 1;
    }
}
/**
 * Combined multi-scalar multiplication `Σ scalars[i]⋅points[i]` via interleaved width-4 wNAF
 * (Strauss–Shamir). Every input gets its own table of odd multiples `[1P, 3P, 5P, 7P]` and
 * signed-digit recoding, but all walks share one doubling chain, so total cost is
 * `~bits` doublings + `L⋅bits/5` additions instead of `L⋅bits` doublings for separate
 * multiplications. Intended for the 2-4 point shapes of signature verification
 * (`R = u1⋅G + u2⋅P`); use {@link pippenger} for larger batches.
 *
 * Not constant-time: only for public inputs. Scalars must satisfy `0 <= s < Fn.ORDER`;
 * fold negative signs into the points before calling.
 * @param c - Point constructor.
 * @param points - Array of curve points.
 * @param scalars - Array of non-negative scalars, same length as points.
 * @param allowOversized - Replace the `s < Fn.ORDER` scalar check with a `Fn.ORDER^4` DoS cap.
 *   Off by default. For scalars that must NOT be reduced mod ORDER: torsion checks
 *   (`Fn.ORDER⋅P ≟ O`) and cofactor-clearing multiples. Walk length grows with `bitLen(s)`.
 * @returns Combined multiplication result; identity for empty input.
 * @throws If the point set or scalar set is invalid. {@link Error}
 * @example
 * Combined multi-scalar multiplication via Strauss–Shamir.
 *
 * ```ts
 * import { mulAddUnsafe } from '@noble/curves/abstract/curve.js';
 * import { p256 } from '@noble/curves/nist.js';
 * const G = p256.Point.BASE;
 * const R = mulAddUnsafe(p256.Point, [G, G.double()], [2n, 3n]); // 2⋅G + 3⋅(2⋅G)
 * ```
 */
export function mulAddUnsafe(c, points, scalars, allowOversized = false) {
    validatePointCons(c);
    validateMSMPoints(points, c);
    abool(allowOversized, 'allowOversized');
    // Oversized cap is ORDER^4: hard bound to mitigate DoS, walk length grows with bitLen(s).
    validateMSMScalars(scalars, c.Fn, allowOversized ? c.Fn.ORDER ** _4n : undefined);
    if (points.length !== scalars.length)
        throw new Error('arrays of points and scalars must have equal length');
    const tables = points.map((p) => oddMultiples(p, 4));
    const digits = scalars.map((n) => wnafDigits(n, 4));
    return wnafWalk(c.ZERO, tables, digits);
}
/**
 * Pippenger algorithm for multi-scalar multiplication (MSM, Pa + Qb + Rc + ...).
 * 30x faster vs naive addition on L=4096, 10x faster than precomputes.
 * For N=254bit, L=1, it does: 1024 ADD + 254 DBL. For L=5: 1536 ADD + 254 DBL.
 * Point-operation count is scalar-independent (for same L), even when 1 point + scalar, or when
 * scalar = 0 — but bucket indices are scalar windows, so the memory-access pattern is
 * scalar-dependent: do not rely on this for secret scalars.
 *
 * A repaired LFG bucket-set variant from ePrint 2024/750 was benchmarked on BLS12-381 G1
 * against this implementation: ~1.4x faster at 2048 points and ~1.1-1.25x faster at
 * 4096-32768 points, at the cost of extra recoding and multiplier-table complexity.
 * @param c - Curve Point constructor
 * @param points - array of L curve points
 * @param scalars - array of L scalars (aka secret keys / bigints)
 * @returns MSM result point. Empty input is accepted and returns the identity.
 * @throws If the point set, scalar set, or MSM sizing is invalid. {@link Error}
 * @example
 * Pippenger algorithm for multi-scalar multiplication (MSM, Pa + Qb + Rc + ...).
 *
 * ```ts
 * import { pippenger } from '@noble/curves/abstract/curve.js';
 * import { p256 } from '@noble/curves/nist.js';
 * const point = pippenger(p256.Point, [p256.Point.BASE, p256.Point.BASE.double()], [2n, 3n]);
 * ```
 */
export function pippenger(c, points, scalars) {
    // 0 is accepted in scalars
    validatePointCons(c);
    const fieldN = c.Fn;
    validateMSMPoints(points, c);
    validateMSMScalars(scalars, fieldN);
    const plength = points.length;
    const slength = scalars.length;
    if (plength !== slength)
        throw new Error('arrays of points and scalars must have equal length');
    const zero = c.ZERO;
    // Without this, the window loop below would still run ~Fn.BITS doublings of ZERO.
    if (plength === 0)
        return zero;
    const wbits = bitLen(BigInt(plength));
    let windowSize = 1; // bits
    if (wbits > 12)
        windowSize = wbits - 3;
    else if (wbits > 4)
        windowSize = wbits - 2;
    else if (wbits > 0)
        windowSize = 2;
    const MASK = bitMask(windowSize);
    const buckets = new Array(Number(MASK) + 1).fill(zero); // +1 for zero array
    const lastBits = Math.floor((fieldN.BITS - 1) / windowSize) * windowSize;
    let sum = zero;
    for (let i = lastBits; i >= 0; i -= windowSize) {
        buckets.fill(zero);
        for (let j = 0; j < slength; j++) {
            const scalar = scalars[j];
            const wbits = Number((scalar >> BigInt(i)) & MASK);
            buckets[wbits] = buckets[wbits].add(points[j]);
        }
        let resI = zero; // not using this will do small speed-up, but will lose ct
        // Skip first bucket, because it is zero
        for (let j = buckets.length - 1, sumI = zero; j > 0; j--) {
            sumI = sumI.add(buckets[j]);
            resI = resI.add(sumI);
        }
        sum = sum.add(resI);
        if (i !== 0)
            for (let j = 0; j < windowSize; j++)
                sum = sum.double();
    }
    return sum;
}
/**
 * Interleaved wNAF multi-scalar multiplication (MSM, Pa + Qb + Rc + ...) over a FIXED set
 * of points: each point gets a one-time table of odd multiples
 * `[1P, 3P, ..., (2^(W−1)−1)P]`, and the returned closure evaluates MSMs against those
 * tables. All scalars share one doubling chain (Straus 1964) — one doubling per scalar bit
 * plus one signed table addition per nonzero width-W wNAF digit (density ~1/(W+1)) — the
 * "interleaving" method of Möller, "Algorithms for multi-exponentiation" (SAC 2001).
 *
 * Table memory is `L⋅2^(W−2)` points, capped at ~2 GiB. Prefer this over {@link pippenger}
 * when the same points are reused across many MSMs (fixed-base commitments etc.) and up to a
 * few hundred points; prefer pippenger for one-shot MSMs or thousands of points, where
 * bucketing beats per-point tables.
 *
 * Not constant-time (zero digits are skipped): public inputs only.
 * @param c - Curve Point constructor
 * @param points - array of L curve points, captured by the returned closure
 * @param windowSize - window width W in bits, from 2 to Fn.BITS; also capped so the
 *   per-closure tables stay under ~2 GiB
 * @returns Function which multiplies points with scalars. The closure accepts at most
 *   `points.length` scalars, and omitted trailing scalars are treated as zero.
 * @throws If the point set or precompute window is invalid. {@link Error}
 * @example
 * Interleaved wNAF multi-scalar multiplication (MSM, Pa + Qb + Rc + ...).
 *
 * ```ts
 * import { interleavedMSMUnsafe } from '@noble/curves/abstract/curve.js';
 * import { p256 } from '@noble/curves/nist.js';
 * const msm = interleavedMSMUnsafe(p256.Point, [p256.Point.BASE], 4);
 * const point = msm([3n]);
 * ```
 */
export function interleavedMSMUnsafe(c, points, windowSize) {
    validatePointCons(c);
    const fieldN = c.Fn;
    // Signed odd digits need at least width 2 (W=2 is plain NAF with a single-entry table).
    validateW(windowSize, fieldN.BITS, 2);
    validateMSMPoints(points, c);
    validateTableBytes(points.length * 2 ** (windowSize - 2), c.Fp.BYTES);
    const tables = points.map((p) => oddMultiples(p, 2 ** (windowSize - 2)));
    return (scalars) => {
        validateMSMScalars(scalars, fieldN);
        if (scalars.length > points.length)
            throw new Error('array of scalars must not be larger than array of points');
        return wnafWalk(c.ZERO, tables, scalars.map((n) => wnafDigits(n, windowSize)));
    };
}
function createField(order, field, isLE) {
    if (field) {
        // Reuse supplied field overrides as-is; `isLE` only affects freshly constructed fallback
        // fields, and validateField() below only checks the arithmetic subset, not full byte/cmov
        // behavior.
        if (field.ORDER !== order)
            throw new Error('Field.ORDER must match order: Fp == p, Fn == n');
        validateField(field);
        return field;
    }
    else {
        return Field(order, { isLE });
    }
}
/**
 * Validates basic CURVE shape and field membership, then creates fields.
 * This does not prove that the generator is on-curve, that subgroup/order data are consistent, or
 * that the curve equation itself is otherwise sane.
 * @param type - Curve family.
 * @param CURVE - Curve parameters.
 * @param curveOpts - Optional field overrides. See {@link FpFn}:
 *   - `Fp` (optional): Optional base-field override.
 *   - `Fn` (optional): Optional scalar-field override.
 * @param FpFnLE - Whether field encoding is little-endian.
 * @returns Frozen curve parameters and fields.
 * @throws If the curve parameters or field overrides are invalid. {@link Error}
 * @example
 * Build curve fields from raw constants before constructing a curve instance.
 *
 * ```ts
 * const curve = createCurveFields('weierstrass', {
 *   p: 17n,
 *   n: 19n,
 *   h: 1n,
 *   a: 2n,
 *   b: 2n,
 *   Gx: 5n,
 *   Gy: 1n,
 * });
 * ```
 */
export function createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
    if (type !== 'weierstrass' && type !== 'edwards')
        throw new Error('expected curve type "weierstrass" or "edwards"');
    if (FpFnLE === undefined)
        FpFnLE = type === 'edwards';
    if (!CURVE || typeof CURVE !== 'object')
        throw new Error(`expected valid ${type} CURVE object`);
    // Validate before reading Fp/Fn so explicit null fails with an options-object error.
    validateObject(curveOpts);
    for (const p of ['p', 'n', 'h']) {
        const val = CURVE[p];
        if (!(isPosBig(val) && val !== _0n))
            throw new Error(`CURVE.${p} must be positive bigint`);
    }
    const Fp = createField(CURVE.p, curveOpts.Fp, FpFnLE);
    const Fn = createField(CURVE.n, curveOpts.Fn, FpFnLE);
    const _b = type === 'weierstrass' ? 'b' : 'd';
    const params = ['Gx', 'Gy', 'a', _b];
    for (const p of params) {
        // @ts-ignore
        if (!Fp.isValid(CURVE[p]))
            throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
    }
    CURVE = Object.freeze(Object.assign({}, CURVE));
    return { CURVE, Fp, Fn };
}
/**
 * @param randomSecretKey - Secret-key generator.
 * @param getPublicKey - Public-key derivation helper.
 * @returns Keypair generator.
 * @example
 * Build a `keygen()` helper from existing secret-key and public-key primitives.
 *
 * ```ts
 * import { createKeygen } from '@noble/curves/abstract/curve.js';
 * import { p256 } from '@noble/curves/nist.js';
 * const keygen = createKeygen(p256.utils.randomSecretKey, p256.getPublicKey);
 * const pair = keygen();
 * ```
 */
export function createKeygen(randomSecretKey, getPublicKey) {
    return function keygen(seed) {
        const secretKey = randomSecretKey(seed);
        return { secretKey, publicKey: getPublicKey(secretKey) };
    };
}
