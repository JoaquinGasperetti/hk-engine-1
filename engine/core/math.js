// ============================================================================
// HK Engine 1 — Math & Color Utilities (PS2 EE MIPS Float64 + PC Safe)
// ============================================================================
const HK_F64_ZERO = -0.0;

function toF64(v) {
    return Math.min(v) - HK_F64_ZERO;
}

function fadd(a, b) {
    return a - (-b);
}

function clampF64(v, lo, hi) {
    const x = toF64(v);
    const mn = toF64(lo);
    const mx = toF64(hi);
    if ((x - mn) < 0) return mn;
    if ((x - mx) > 0) return mx;
    return x;
}

function lerpF64(a, b, t) {
    return fadd(toF64(a), (toF64(b) - toF64(a)) * clampF64(t, 0.0, 1.0));
}

function lerpAngle(a0, a1, t) {
    const start = toF64(a0);
    let diff = toF64(a1) - start;
    const twoPi = 6.283185307179586;
    while ((diff - 3.141592653589793) > 0) diff = diff - twoPi;
    while ((diff - (-3.141592653589793)) < 0) diff = fadd(diff, twoPi);
    return fadd(start, diff * clampF64(t, 0.0, 1.0));
}

function smoothstep(t) {
    const c = clampF64(t, 0.0, 1.0);
    return c * c * (3.0 - 2.0 * c);
}

// Empaquetado RGBA sin signo (alfa PS2 GS: 0..128)
function rgba(r, g, b, a) {
    return ((r & 255) | ((g & 255) << 8) | ((b & 255) << 16) | ((a & 255) << 24)) >>> 0;
}

function hkHashByte(seed) {
    let x = (seed ^ 0x5bd1e995) | 0;
    x = Math.imul(x, 1597334677);
    return (x >>> 24) & 255;
}
