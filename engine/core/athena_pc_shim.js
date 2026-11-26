// ============================================================================
// HK Engine 1 — AthenaEnv V4 Compatibility Shim for PC / Desktop (.exe)
// Permite ejecutar y exportar a PC proyectos escritos para PS2 (AthenaEnv V4)
// con soporte completo de Screen, Draw, Font, Image, Sound.Stream, Pads
// (Teclado + Mouse + Gamepad) y persistencia en localStorage.
// ============================================================================
(function (global) {
    "use strict";

    const ASSET_SET = {};
    if (Array.isArray(global.HK_ASSET_MANIFEST)) {
        for (let i = 0; i < global.HK_ASSET_MANIFEST.length; i++) {
            ASSET_SET[global.HK_ASSET_MANIFEST[i]] = true;
        }
    }

    const canvas = document.getElementById("hk-canvas") || document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 448;
    const ctx = canvas.getContext("2d");

    function colToCss(col) {
        const c = col >>> 0;
        const r = c & 255;
        const g = (c >>> 8) & 255;
        const b = (c >>> 16) & 255;
        const a = Math.min(1.0, ((c >>> 24) & 255) / 128.0);
        return "rgba(" + r + "," + g + "," + b + "," + a.toFixed(3) + ")";
    }

    // Color
    global.Color = {
        new: function (r, g, b, a) {
            const al = (a === undefined) ? 128 : a;
            return ((r & 255) | ((g & 255) << 8) | ((b & 255) << 16) | ((al & 255) << 24)) >>> 0;
        }
    };

    // Screen
    let clearCss = "#05060a";
    let fpsNow = 60;
    let fpsFrames = 0;
    let fpsLast = performance.now();

    global.Z16S = 1;
    global.Screen = {
        Z16S: 1,
        DEPTH_TEST_ENABLE: 1,
        DEPTH_TEST_METHOD: 2,
        DEPTH_GEQUAL: 3,
        DEPTH_ALWAYS: 4,
        ALPHA_TEST_ENABLE: 5,
        DST_ALPHA_TEST_ENABLE: 6,
        SCISSOR_BOUNDS: 7,
        VRAM_USED_TOTAL: 1,
        VRAM_SIZE: 2,
        getMode: function () { return { width: 640, height: 448, zbuffering: false, psmz: 1 }; },
        setMode: function () {},
        setVSync: function () {},
        setFrameCounter: function () {},
        setParam: function () {},
        clearColor: function (c) { clearCss = colToCss(c); },
        clear: function () {
            ctx.fillStyle = clearCss;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        },
        getFPS: function () { return fpsNow; },
        getFreeVRAM: function () { return 1024 * 1024; },
        getMemoryStats: function (k) { return k === 2 ? (4 * 1024 * 1024) : (1024 * 1024); },
        display: function (cb) {
            function frame(ts) {
                fpsFrames++;
                if (ts - fpsLast >= 500) {
                    fpsNow = Math.round((fpsFrames * 1000) / (ts - fpsLast));
                    fpsFrames = 0;
                    fpsLast = ts;
                }
                global.Screen.clear();
                try { cb(); } catch (err) {
                    ctx.fillStyle = "#1a0505";
                    ctx.fillRect(0, 0, 640, 448);
                    ctx.fillStyle = "#ff8080";
                    ctx.font = "14px monospace";
                    ctx.fillText("PC Runtime Error: " + String(err), 16, 28);
                    console.error(err);
                }
                requestAnimationFrame(frame);
            }
            requestAnimationFrame(frame);
        }
    };

    // Draw
    global.Draw = {
        rect: function (x, y, w, h, col) {
            ctx.fillStyle = colToCss(col);
            ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
        },
        line: function (x0, y0, x1, y1, col) {
            ctx.strokeStyle = colToCss(col);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
        },
        triangle: function (x1, y1, x2, y2, x3, y3, c1) {
            ctx.fillStyle = colToCss(c1);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.lineTo(x3, y3);
            ctx.closePath();
            ctx.fill();
        },
        quad: function (x1, y1, x2, y2, x3, y3, x4, y4, c1) {
            ctx.fillStyle = colToCss(c1);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.lineTo(x3, y3);
            ctx.lineTo(x4, y4);
            ctx.closePath();
            ctx.fill();
        }
    };

    // Font
    function PCFont() {
        this.scale = 0.72;
        this.color = global.Color.new(240, 240, 245, 128);
    }
    PCFont.prototype.print = function (x, y, text) {
        const px = Math.max(11, Math.round((this.scale || 0.72) * 21));
        ctx.font = "700 " + px + "px 'Segoe UI', system-ui, monospace";
        ctx.fillStyle = colToCss(this.color);
        ctx.textBaseline = "top";
        ctx.fillText(String(text), x | 0, y | 0);
    };
    global.Font = PCFont;

    // Image (sobrecarga del constructor nativo para rutas AthenaEnv)
    const NativeImage = global.Image;
    function PCImage(path) {
        this._img = new NativeImage();
        this._ready = false;
        this.width = 256;
        this.height = 256;
        this.color = global.Color.new(128, 128, 128, 128);
        const self = this;
        this._img.onload = function () {
            self._ready = true;
            if (!self._customW) self.width = self._img.naturalWidth || 256;
            if (!self._customH) self.height = self._img.naturalHeight || 256;
        };
        if (path) this._img.src = path;
    }
    PCImage.prototype.draw = function (x, y) {
        if (!this._ready) return;
        const a = Math.min(1.0, (((this.color >>> 24) & 255) / 128.0));
        ctx.save();
        ctx.globalAlpha = a;
        ctx.drawImage(this._img, x | 0, y | 0, this.width | 0, this.height | 0);
        ctx.restore();
    };
    PCImage.prototype.optimize = function () {};
    PCImage.prototype.free = function () { this._ready = false; this._img.src = ""; };
    global.Image = PCImage;

    // Sound (HTML5 Audio real para ambient.ogg y chase.ogg)
    let masterVol = 0.75;
    const activeStreams = [];
    let audioUnlocked = false;
    function unlockAudio() {
        if (audioUnlocked) return;
        audioUnlocked = true;
        for (let i = 0; i < activeStreams.length; i++) {
            const st = activeStreams[i];
            if (st._wantPlay && st._el.paused) {
                st._el.play().catch(function () {});
            }
        }
    }
    window.addEventListener("keydown", unlockAudio, { passive: true });
    window.addEventListener("mousedown", unlockAudio, { passive: true });

    function PCStream(path) {
        this._el = new Audio(path);
        this._el.loop = true;
        this._el.volume = masterVol;
        this._wantPlay = false;
        this.loop = true;
        activeStreams.push(this);
    }
    PCStream.prototype.play = function () {
        this._el.loop = !!this.loop;
        this._el.volume = masterVol;
        this._wantPlay = true;
        this._el.play().catch(function () {});
    };
    PCStream.prototype.pause = function () {
        this._wantPlay = false;
        this._el.pause();
    };
    PCStream.prototype.rewind = function () {
        try { this._el.currentTime = 0; } catch (_) {}
    };
    PCStream.prototype.playing = function () {
        return !this._el.paused && !this._el.ended;
    };

    function PCSfx() {}
    PCSfx.prototype.play = function () {};

    global.Sound = {
        Stream: PCStream,
        Sfx: PCSfx,
        setVolume: function (v) {
            masterVol = Math.max(0, Math.min(1, (v || 0) / 100.0));
            for (let i = 0; i < activeStreams.length; i++) {
                activeStreams[i]._el.volume = masterVol;
            }
        }
    };

    // Pads (Teclado + Mouse + Gamepad HTML5 mapeados a DualShock 2)
    const P = {
        SELECT: 1 << 0, START: 1 << 3,
        UP: 1 << 4, RIGHT: 1 << 5, DOWN: 1 << 6, LEFT: 1 << 7,
        L2: 1 << 8, R2: 1 << 9, L1: 1 << 10, R1: 1 << 11,
        TRIANGLE: 1 << 12, CIRCLE: 1 << 13, CROSS: 1 << 14, SQUARE: 1 << 15,
        STATE_FINDCTP1: 5, STATE_STABLE: 6
    };
    const keysDown = {};
    let mouseDX = 0, mouseDY = 0;
    window.addEventListener("keydown", function (e) {
        keysDown[e.code] = true;
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab"].indexOf(e.code) !== -1) {
            e.preventDefault();
        }
    });
    window.addEventListener("keyup", function (e) { keysDown[e.code] = false; });
    canvas.addEventListener("click", function () {
        if (canvas.requestPointerLock) canvas.requestPointerLock();
    });
    window.addEventListener("mousemove", function (e) {
        if (document.pointerLockElement === canvas) {
            mouseDX += e.movementX || 0;
            mouseDY += e.movementY || 0;
        }
    });

    const padObj = {
        lx: 0, ly: 0, rx: 0, ry: 0,
        _cur: 0, _prev: 0,
        update: function () {
            this._prev = this._cur;
            let mask = 0;
            if (keysDown.KeyW || keysDown.ArrowUp) mask |= P.UP;
            if (keysDown.KeyS || keysDown.ArrowDown) mask |= P.DOWN;
            if (keysDown.KeyA) mask |= P.LEFT;
            if (keysDown.KeyD) mask |= P.RIGHT;
            if (keysDown.ArrowLeft || keysDown.KeyQ) mask |= P.L1;
            if (keysDown.ArrowRight) mask |= P.R1;
            if (keysDown.KeyE || keysDown.Enter || keysDown.Space) mask |= P.CROSS;
            if (keysDown.ShiftLeft || keysDown.ShiftRight || keysDown.Backspace) mask |= P.CIRCLE;
            if (keysDown.KeyC || keysDown.ControlLeft) mask |= P.SQUARE;
            if (keysDown.KeyF) mask |= P.TRIANGLE;
            if (keysDown.KeyG) mask |= P.L2;
            if (keysDown.F3) mask |= P.R2;
            if (keysDown.Tab || keysDown.KeyM) mask |= P.SELECT;
            if (keysDown.Escape || keysDown.KeyP) mask |= P.START;

            this.lx = 0; this.ly = 0;
            this.rx = Math.max(-127, Math.min(127, (mouseDX * 9) | 0));
            this.ry = Math.max(-127, Math.min(127, (mouseDY * 9) | 0));
            mouseDX = 0; mouseDY = 0;

            // Soporte opcional de Gamepad USB conectado al PC
            const gps = navigator.getGamepads ? navigator.getGamepads() : [];
            const gp = gps && gps[0];
            if (gp) {
                this.lx = (gp.axes[0] * 127) | 0;
                this.ly = (gp.axes[1] * 127) | 0;
                if (Math.abs(gp.axes[2]) > 0.15) this.rx = (gp.axes[2] * 127) | 0;
                if (Math.abs(gp.axes[3]) > 0.15) this.ry = (gp.axes[3] * 127) | 0;
                if (gp.buttons[0] && gp.buttons[0].pressed) mask |= P.CROSS;
                if (gp.buttons[1] && gp.buttons[1].pressed) mask |= P.CIRCLE;
                if (gp.buttons[2] && gp.buttons[2].pressed) mask |= P.SQUARE;
                if (gp.buttons[3] && gp.buttons[3].pressed) mask |= P.TRIANGLE;
                if (gp.buttons[4] && gp.buttons[4].pressed) mask |= P.L1;
                if (gp.buttons[5] && gp.buttons[5].pressed) mask |= P.R1;
                if (gp.buttons[6] && gp.buttons[6].pressed) mask |= P.L2;
                if (gp.buttons[7] && gp.buttons[7].pressed) mask |= P.R2;
                if (gp.buttons[8] && gp.buttons[8].pressed) mask |= P.SELECT;
                if (gp.buttons[9] && gp.buttons[9].pressed) mask |= P.START;
            }
            this._cur = mask;
        },
        pressed: function (btn) { return (this._cur & btn) !== 0; },
        justPressed: function (btn) { return (this._cur & btn) !== 0 && (this._prev & btn) === 0; }
    };

    global.Pads = Object.assign(P, {
        get: function () { return padObj; },
        getState: function () { return P.STATE_STABLE; },
        isActive: function () { return true; },
        rumble: function () {}
    });

    // IOP, System, std, os (persistencia en localStorage)
    global.IOP = { getModule: function () { return true; }, loadModule: function () { return true; } };
    global.System = {
        getCPUInfo: function () { return { CPUClock: 294 }; },
        getGPUInfo: function () { return { id: 1, revision: 0 }; },
        getMCInfo: function () { return { type: 2 }; },
        getMemoryStats: function () { return { used: 8 * 1024 * 1024, total: 32 * 1024 * 1024 }; }
    };
    global.os = { mkdir: function () {}, sleep: function () {} };
    global.std = {
        exists: function (p) {
            if (ASSET_SET[p]) return true;
            try { return localStorage.getItem("hk_mc_" + p) !== null; } catch (_) { return false; }
        },
        loadFile: function (p) {
            try { return localStorage.getItem("hk_mc_" + p); } catch (_) { return null; }
        },
        open: function (p) {
            return {
                puts: function (txt) { try { localStorage.setItem("hk_mc_" + p, String(txt)); } catch (_) {} },
                close: function () {}
            };
        },
        gc: function () {}
    };
})(window);
