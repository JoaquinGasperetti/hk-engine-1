// ============================================================================
// HK Engine 1 — Platform Backend: PC Desktop / Browser (WebGL 3D + Canvas HUD)
// Permite exportar el mismo juego como app web o ejecutable Windows/Linux (.exe)
// ============================================================================
function hkColorToCss(col) {
    const r = col & 255;
    const g = (col >>> 8) & 255;
    const b = (col >>> 16) & 255;
    const a = Math.min(1.0, ((col >>> 24) & 255) / 128.0);
    return "rgba(" + r + "," + g + "," + b + "," + a.toFixed(3) + ")";
}

const HKPlatform = {
    name: "PC",
    screenW: 960,
    screenH: 540,
    isPAL: false,
    depthReady: true,
    canvas: null,
    ctx: null,
    clearCss: "#06080d",
    keys: {},
    justKeys: {},
    mouseDX: 0,
    mouseDY: 0,

    init: function (canvasId) {
        this.canvas = document.getElementById(canvasId || "hk-canvas");
        if (!this.canvas) {
            this.canvas = document.createElement("canvas");
            this.canvas.id = "hk-canvas";
            document.body.appendChild(this.canvas);
        }
        this.canvas.width = this.screenW;
        this.canvas.height = this.screenH;
        this.ctx = this.canvas.getContext("2d");
        const pointerTarget = document.getElementById("hk-gl-canvas") || this.canvas;

        const self = this;
        window.addEventListener("keydown", function (e) {
            if (!self.keys[e.code]) self.justKeys[e.code] = true;
            self.keys[e.code] = true;
            if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].indexOf(e.code) !== -1) {
                e.preventDefault();
            }
        });
        window.addEventListener("keyup", function (e) {
            self.keys[e.code] = false;
        });
        pointerTarget.addEventListener("click", function () {
            if (pointerTarget.requestPointerLock) pointerTarget.requestPointerLock();
        });
        window.addEventListener("mousemove", function (e) {
            if (document.pointerLockElement === pointerTarget || document.pointerLockElement === self.canvas) {
                self.mouseDX += e.movementX || 0;
                self.mouseDY += e.movementY || 0;
            }
        });
    },

    fileExists: function () { return false; },

    clearColor: function (r, g, b) {
        this.clearCss = "rgb(" + (r | 0) + "," + (g | 0) + "," + (b | 0) + ")";
    },

    rect: function (x, y, w, h, col) {
        this.ctx.fillStyle = hkColorToCss(col);
        this.ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
    },

    line: function (x0, y0, x1, y1, col) {
        this.ctx.strokeStyle = hkColorToCss(col);
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.moveTo(x0, y0);
        this.ctx.lineTo(x1, y1);
        this.ctx.stroke();
    },

    text: function (x, y, str, scale, col) {
        const px = Math.max(12, Math.round((scale || 0.72) * 22));
        this.ctx.font = "600 " + px + "px 'Segoe UI', system-ui, monospace";
        this.ctx.fillStyle = hkColorToCss(col || rgba(240, 240, 245, 128));
        this.ctx.textBaseline = "top";
        this.ctx.fillText(String(str), x | 0, y | 0);
    },

    restore2D: function () {},

    readInput: function (out) {
        const k = this.keys;
        const j = this.justKeys;
        out.moveY = (k.KeyW || k.ArrowUp ? 1.0 : 0.0) - (k.KeyS || k.ArrowDown ? 1.0 : 0.0);
        out.moveX = (k.KeyD ? 1.0 : 0.0) - (k.KeyA ? 1.0 : 0.0);
        out.lookX = (k.ArrowRight ? 0.9 : 0.0) - (k.ArrowLeft ? 0.9 : 0.0) + clampF64(this.mouseDX * 0.06, -1.5, 1.5);
        out.lookY = clampF64(-this.mouseDY * 0.05, -1.5, 1.5);
        this.mouseDX = 0;
        this.mouseDY = 0;

        out.confirm = !!(j.KeyE || j.Enter || j.Space);
        out.cancel = !!(j.Backspace || j.KeyQ);
        out.sprint = !!(k.ShiftLeft || k.ShiftRight);
        out.crouch = !!(j.KeyC || j.ControlLeft);
        out.action = !!(j.KeyF);
        out.secondary = !!(j.KeyG);
        out.map = !!(j.Tab || j.KeyM);
        out.pause = !!(j.Escape || j.KeyP);
        out.debug = !!(j.F3);
        out.startHeld = !!(k.Enter || k.Space);

        for (const code in j) j[code] = false;
    },

    saveJSON: function (slot, obj) {
        try { localStorage.setItem("hk_save_" + slot, JSON.stringify(obj)); return true; }
        catch (_) { return false; }
    },

    loadJSON: function (slot) {
        try {
            const raw = localStorage.getItem("hk_save_" + slot);
            return raw ? JSON.parse(raw) : null;
        } catch (_) { return null; }
    },

    yieldAudio: function () {},

    runLoop: function (tickFn) {
        const self = this;
        function frame() {
            self.ctx.clearRect(0, 0, self.screenW, self.screenH);
            tickFn();
            window.requestAnimationFrame(frame);
        }
        window.requestAnimationFrame(frame);
    }
};
