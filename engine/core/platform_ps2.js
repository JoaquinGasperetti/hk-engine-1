// ============================================================================
// HK Engine 1 — Platform Backend: PlayStation 2 (AthenaEnv V4 clean-api)
// ============================================================================
function hkFixProto(obj, Cls) {
    if (!obj || typeof Cls !== "function" || !Cls.prototype) return obj;
    try {
        if (Object.getPrototypeOf(obj) !== Cls.prototype) {
            Object.setPrototypeOf(obj, Cls.prototype);
        }
    } catch (_) {}
    return obj;
}

const HKPlatform = {
    name: "PS2",
    screenW: 640,
    screenH: 448,
    isPAL: false,
    depthReady: false,
    font: null,
    pad: null,

    init: function () {
        const mode = Screen.getMode();
        this.screenW = mode.width || 640;
        this.screenH = mode.height || 448;
        this.isPAL = this.screenH >= 500;
        try {
            mode.zbuffering = true;
            if (typeof Z16S !== "undefined") mode.psmz = Z16S;
            else if (typeof Screen.Z16S !== "undefined") mode.psmz = Screen.Z16S;
            Screen.setMode(mode);
            this.depthReady = true;
        } catch (_) {
            this.depthReady = false;
        }
        try { Screen.setVSync(true); } catch (_) {}
        try { this.pad = Pads.get(0); } catch (_) { this.pad = null; }
        try {
            if (typeof Font === "function") {
                if (typeof std !== "undefined" && std.exists("assets/fonts/ui.ttf")) {
                    this.font = new Font("assets/fonts/ui.ttf");
                } else {
                    this.font = new Font("default");
                }
            }
        } catch (_) {
            this.font = null;
        }
    },

    fileExists: function (path) {
        try { return (typeof std !== "undefined" && typeof std.exists === "function") ? !!std.exists(path) : false; }
        catch (_) { return false; }
    },

    clearColor: function (r, g, b) {
        try { Screen.clearColor(rgba(r, g, b, 128)); } catch (_) {}
    },

    rect: function (x, y, w, h, col) {
        Draw.rect(x | 0, y | 0, w | 0, h | 0, col);
    },

    line: function (x0, y0, x1, y1, col) {
        Draw.line(x0 | 0, y0 | 0, x1 | 0, y1 | 0, col);
    },

    text: function (x, y, str, scale, col) {
        if (!this.font) return;
        this.font.scale = Math.fround(scale || 0.72);
        this.font.color = col || rgba(240, 240, 245, 128);
        this.font.print(x | 0, y | 0, String(str));
    },

    restore2D: function () {
        if (typeof Screen === "undefined" || typeof Screen.setParam !== "function") return;
        try { Screen.setParam(Screen.DEPTH_TEST_ENABLE, false); } catch (_) {}
        try { Screen.setParam(Screen.DEPTH_TEST_METHOD, Screen.DEPTH_ALWAYS); } catch (_) {}
        try { Screen.setParam(Screen.ALPHA_TEST_ENABLE, false); } catch (_) {}
        try { Screen.setParam(Screen.SCISSOR_BOUNDS, { x1: 0, y1: 0, x2: this.screenW - 1, y2: this.screenH - 1 }); } catch (_) {}
    },

    readInput: function (out) {
        if (!this.pad) return;
        this.pad.update();
        const dead = 0.22;
        const lx = toF64((this.pad.lx || 0) / 128.0);
        const ly = toF64((this.pad.ly || 0) / 128.0);
        const rx = toF64((this.pad.rx || 0) / 128.0);
        const ry = toF64((this.pad.ry || 0) / 128.0);
        out.moveY = (Math.abs(ly) > dead ? -ly : 0.0) + (this.pad.pressed(Pads.UP) ? 1.0 : 0.0) - (this.pad.pressed(Pads.DOWN) ? 1.0 : 0.0);
        out.moveX = (Math.abs(lx) > dead ? lx : 0.0) + (this.pad.pressed(Pads.RIGHT) ? 1.0 : 0.0) - (this.pad.pressed(Pads.LEFT) ? 1.0 : 0.0);
        out.lookX = (Math.abs(rx) > dead ? rx : 0.0) + (this.pad.pressed(Pads.R1) ? 0.85 : 0.0) - (this.pad.pressed(Pads.L1) ? 0.85 : 0.0);
        out.lookY = (Math.abs(ry) > dead ? -ry : 0.0);
        out.confirm = this.pad.justPressed(Pads.CROSS);
        out.cancel = this.pad.justPressed(Pads.CIRCLE);
        out.sprint = this.pad.pressed(Pads.CIRCLE);
        out.crouch = this.pad.justPressed(Pads.SQUARE);
        out.action = this.pad.justPressed(Pads.TRIANGLE);
        out.secondary = this.pad.justPressed(Pads.L2);
        out.map = this.pad.justPressed(Pads.SELECT);
        out.pause = this.pad.justPressed(Pads.START);
        out.debug = this.pad.justPressed(Pads.R2);
        out.startHeld = this.pad.pressed(Pads.START);
    },

    saveJSON: function (slot, obj) {
        try {
            const dir = "mc0:/HKENGINE";
            if (typeof os !== "undefined" && os.mkdir) { try { os.mkdir(dir); } catch (_) {} }
            const f = std.open(dir + "/" + slot + ".json", "w");
            if (!f) return false;
            f.puts(JSON.stringify(obj));
            f.close();
            return true;
        } catch (_) { return false; }
    },

    loadJSON: function (slot) {
        try {
            const p = "mc0:/HKENGINE/" + slot + ".json";
            if (!std.exists(p)) return null;
            return JSON.parse(std.loadFile(p));
        } catch (_) { return null; }
    },

    yieldAudio: function () {
        if (typeof os !== "undefined" && typeof os.sleep === "function") {
            try { os.sleep(3); } catch (_) {}
        }
    },

    runLoop: function (tickFn) {
        Screen.display(function () {
            Screen.clear();
            tickFn();
        });
    }
};
