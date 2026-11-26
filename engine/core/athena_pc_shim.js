// ============================================================================
// HK Engine 1 — AthenaEnv V4 WebGL 3D + PC Input Shim (PC / .exe)
// - Renderizado 3D REAL por hardware (WebGL 1.0) con carga de Wavefront .obj,
//   texturas PNG, Z-buffer y 2 luces direccionales + ambiente dinámicas.
// - Capa 2D transparente superpuesta para HUD, menús, PDA y cinemáticas.
// - Controles nativos de PC: Mouse (Pointer Lock) para cámara 3D horizontal
//   y vertical + Teclado WASD + soporte opcional de Gamepad USB.
// ============================================================================
(function (global) {
    "use strict";

    const ASSET_SET = {};
    if (Array.isArray(global.HK_ASSET_MANIFEST)) {
        for (let i = 0; i < global.HK_ASSET_MANIFEST.length; i++) {
            ASSET_SET[global.HK_ASSET_MANIFEST[i]] = true;
        }
    }
    const OBJ_FILES = global.HK_OBJ_FILES || {};

    // Doble canvas: abajo WebGL 3D, arriba 2D HUD/Menús transparente
    const glCanvas = document.getElementById("hk-gl-canvas");
    const canvas2d = document.getElementById("hk-canvas") || document.createElement("canvas");
    canvas2d.width = 640;
    canvas2d.height = 448;
    const ctx = canvas2d.getContext("2d");

    let gl = null;
    if (glCanvas) {
        glCanvas.width = 640;
        glCanvas.height = 448;
        gl = glCanvas.getContext("webgl", { alpha: false, antialias: false, depth: true }) ||
             glCanvas.getContext("experimental-webgl", { alpha: false, antialias: false, depth: true });
    }

    function colToCss(col) {
        const c = col >>> 0;
        const r = c & 255;
        const g = (c >>> 8) & 255;
        const b = (c >>> 16) & 255;
        const a = Math.min(1.0, ((c >>> 24) & 255) / 128.0);
        return "rgba(" + r + "," + g + "," + b + "," + a.toFixed(3) + ")";
    }

    global.Color = {
        new: function (r, g, b, a) {
            const al = (a === undefined) ? 128 : a;
            return ((r & 255) | ((g & 255) << 8) | ((b & 255) << 16) | ((al & 255) << 24)) >>> 0;
        }
    };

    // ========================================================================
    // WEBGL 3D ENGINE (AthenaEnv Render / Camera / Lights / RenderData / RenderObject)
    // ========================================================================
    let glProg = null;
    let glWhiteTex = null;
    let glClearR = 0.02, glClearG = 0.025, glClearB = 0.04;
    let glDrawCalls = 0, glTriangles = 0;

    const projMat = new Float32Array(16);
    const viewMat = new Float32Array(16);
    const modelMat = new Float32Array(16);
    const camPos = [0, 1.55, 0];
    const camTgt = [0, 1.55, 4];

    const lights = [
        { dir: [0, -0.25, -1], amb: [0.20, 0.22, 0.26], diff: [0.95, 0.92, 0.88] },
        { dir: [0, -1.0, 0],   amb: [0.12, 0.14, 0.18], diff: [0.25, 0.28, 0.34] },
        { dir: [0, -1.0, 0],   amb: [0, 0, 0],          diff: [0, 0, 0] },
        { dir: [0, -1.0, 0],   amb: [0, 0, 0],          diff: [0, 0, 0] }
    ];

    function mat4Perspective(out, fovDeg, aspect, near, far) {
        const f = 1.0 / Math.tan((fovDeg * Math.PI / 180.0) * 0.5);
        const nf = 1.0 / (near - far);
        out.fill(0);
        out[0] = f / aspect;
        out[5] = f;
        out[10] = (far + near) * nf;
        out[11] = -1;
        out[14] = (2 * far * near) * nf;
    }

    function mat4LookAt(out, eye, center) {
        let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
        let len = Math.hypot(zx, zy, zz) || 1;
        zx /= len; zy /= len; zz /= len;
        // up = (0, 1, 0)
        let xx = zz, xy = 0, xz = -zx;
        len = Math.hypot(xx, xy, xz) || 1;
        xx /= len; xz /= len;
        const yx = zy * xz - zz * xy;
        const yy = zz * xx - zx * xz;
        const yz = zx * xy - zy * xx;
        out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
        out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
        out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
        out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
        out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
        out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
        out[15] = 1;
    }

    function mat4Model(out, pos, rot) {
        const rx = rot ? (rot.x || 0) : 0;
        const ry = rot ? (rot.y || 0) : 0;
        const rz = rot ? (rot.z || 0) : 0;
        const cx = Math.cos(rx), sx = Math.sin(rx);
        const cy = Math.cos(ry), sy = Math.sin(ry);
        const cz = Math.cos(rz), sz = Math.sin(rz);
        // R = Ry * Rx * Rz
        out[0] = cy * cz + sy * sx * sz;
        out[1] = cx * sz;
        out[2] = -sy * cz + cy * sx * sz;
        out[3] = 0;
        out[4] = -cy * sz + sy * sx * cz;
        out[5] = cx * cz;
        out[6] = sy * sz + cy * sx * cz;
        out[7] = 0;
        out[8] = sy * cx;
        out[9] = -sx;
        out[10] = cy * cx;
        out[11] = 0;
        out[12] = pos ? (pos.x || 0) : 0;
        out[13] = pos ? (pos.y || 0) : 0;
        out[14] = pos ? (pos.z || 0) : 0;
        out[15] = 1;
    }

    function initWebGLProgram() {
        if (!gl || glProg) return !!glProg;
        const vsSrc = `
            attribute vec3 aPos;
            attribute vec2 aUv;
            attribute vec3 aNorm;
            uniform mat4 uProj;
            uniform mat4 uView;
            uniform mat4 uModel;
            varying vec2 vUv;
            varying vec3 vNorm;
            varying float vDist;
            void main() {
                vec4 worldPos = uModel * vec4(aPos, 1.0);
                vec4 viewPos = uView * worldPos;
                vDist = length(viewPos.xyz);
                vUv = aUv;
                vNorm = normalize(mat3(uModel) * aNorm);
                gl_Position = uProj * viewPos;
            }
        `;
        const fsSrc = `
            precision mediump float;
            uniform sampler2D uTex;
            uniform vec3 uL0Dir, uL0Amb, uL0Diff;
            uniform vec3 uL1Dir, uL1Amb, uL1Diff;
            uniform vec3 uFogCol;
            varying vec2 vUv;
            varying vec3 vNorm;
            varying float vDist;
            void main() {
                vec4 tex = texture2D(uTex, vUv);
                vec3 n = normalize(vNorm);
                float d0 = max(dot(n, normalize(-uL0Dir)), 0.0);
                float d1 = max(dot(n, normalize(-uL1Dir)), 0.0);
                // Atenuación suave tipo linterna PS2 por distancia
                float atten = clamp(1.0 - (vDist / 24.0), 0.14, 1.0);
                vec3 light = (uL0Amb + uL1Amb) + (uL0Diff * (0.45 + 0.55 * d0) + uL1Diff * d1) * atten;
                vec3 col = tex.rgb * light;
                float fog = clamp((vDist - 3.5) / 22.0, 0.0, 0.92);
                col = mix(col, uFogCol, fog);
                gl_FragColor = vec4(col, tex.a);
            }
        `;
        function compile(type, src) {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
                console.error("WebGL shader error:", gl.getShaderInfoLog(s));
                return null;
            }
            return s;
        }
        const vs = compile(gl.VERTEX_SHADER, vsSrc);
        const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
        if (!vs || !fs) return false;
        glProg = gl.createProgram();
        gl.attachShader(glProg, vs);
        gl.attachShader(glProg, fs);
        gl.linkProgram(glProg);
        gl.useProgram(glProg);

        glProg.aPos   = gl.getAttribLocation(glProg, "aPos");
        glProg.aUv    = gl.getAttribLocation(glProg, "aUv");
        glProg.aNorm  = gl.getAttribLocation(glProg, "aNorm");
        glProg.uProj  = gl.getUniformLocation(glProg, "uProj");
        glProg.uView  = gl.getUniformLocation(glProg, "uView");
        glProg.uModel = gl.getUniformLocation(glProg, "uModel");
        glProg.uTex   = gl.getUniformLocation(glProg, "uTex");
        glProg.uL0Dir = gl.getUniformLocation(glProg, "uL0Dir");
        glProg.uL0Amb = gl.getUniformLocation(glProg, "uL0Amb");
        glProg.uL0Diff = gl.getUniformLocation(glProg, "uL0Diff");
        glProg.uL1Dir = gl.getUniformLocation(glProg, "uL1Dir");
        glProg.uL1Amb = gl.getUniformLocation(glProg, "uL1Amb");
        glProg.uL1Diff = gl.getUniformLocation(glProg, "uL1Diff");
        glProg.uFogCol = gl.getUniformLocation(glProg, "uFogCol");

        glWhiteTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, glWhiteTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([210, 215, 220, 255]));
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        mat4Perspective(projMat, 60.0, 640 / 448, 0.25, 52.0);
        return true;
    }

    function parseObjText(text) {
        const vp = [], vt = [], vn = [];
        const out = [];
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line[0] === "#") continue;
            const p = line.split(/\s+/);
            if (p[0] === "v") vp.push([+p[1], +p[2], +p[3]]);
            else if (p[0] === "vt") vt.push([+p[1], 1.0 - (+p[2])]);
            else if (p[0] === "vn") vn.push([+p[1], +p[2], +p[3]]);
            else if (p[0] === "f") {
                const idx = [];
                for (let k = 1; k < p.length; k++) {
                    const seg = p[k].split("/");
                    const vi = parseInt(seg[0], 10);
                    const ti = seg[1] ? parseInt(seg[1], 10) : 0;
                    const ni = seg[2] ? parseInt(seg[2], 10) : 0;
                    idx.push([
                        vi < 0 ? vp.length + vi : vi - 1,
                        ti < 0 ? vt.length + ti : ti - 1,
                        ni < 0 ? vn.length + ni : ni - 1
                    ]);
                }
                for (let t = 1; t < idx.length - 1; t++) {
                    const tri = [idx[0], idx[t], idx[t + 1]];
                    for (let c = 0; c < 3; c++) {
                        const v = vp[tri[c][0]] || [0, 0, 0];
                        const u = (tri[c][1] >= 0 && vt[tri[c][1]]) ? vt[tri[c][1]] : [0, 0];
                        const n = (tri[c][2] >= 0 && vn[tri[c][2]]) ? vn[tri[c][2]] : [0, 1, 0];
                        out.push(v[0], v[1], v[2], u[0], u[1], n[0], n[1], n[2]);
                    }
                }
            }
        }
        return new Float32Array(out);
    }

    function createGlTexFromImage(pcImg) {
        if (!gl || !pcImg) return glWhiteTex;
        if (pcImg._glTex) return pcImg._glTex;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([140, 145, 155, 255]));
        function upload() {
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pcImg._img);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        }
        if (pcImg._ready) upload();
        else pcImg._onReadyCallbacks.push(upload);
        pcImg._glTex = tex;
        return tex;
    }

    function PCRenderData(objPath, texImage) {
        this.accurate_clipping = false;
        this.face_culling = 0;
        this.pipeline = 0;
        this._vbo = null;
        this._vertCount = 0;
        this._tex = texImage ? createGlTexFromImage(texImage) : glWhiteTex;
        if (gl && initWebGLProgram() && OBJ_FILES[objPath]) {
            const verts = parseObjText(OBJ_FILES[objPath]);
            this._vertCount = (verts.length / 8) | 0;
            this._vbo = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this._vbo);
            gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
        }
    }
    global.RenderData = PCRenderData;

    function PCRenderObject(renderData) {
        this._data = renderData;
        this.position = { x: 0, y: 0, z: 0 };
        this.rotation = { x: 0, y: 0, z: 0 };
    }
    PCRenderObject.prototype.render = function () {
        if (!gl || !glProg || !this._data || !this._data._vbo || this._data._vertCount === 0) return;
        mat4Model(modelMat, this.position, this.rotation);
        gl.uniformMatrix4fv(glProg.uModel, false, modelMat);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._data._tex || glWhiteTex);
        gl.uniform1i(glProg.uTex, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this._data._vbo);
        const stride = 8 * 4;
        gl.enableVertexAttribArray(glProg.aPos);
        gl.vertexAttribPointer(glProg.aPos, 3, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(glProg.aUv);
        gl.vertexAttribPointer(glProg.aUv, 2, gl.FLOAT, false, stride, 3 * 4);
        gl.enableVertexAttribArray(glProg.aNorm);
        gl.vertexAttribPointer(glProg.aNorm, 3, gl.FLOAT, false, stride, 5 * 4);
        gl.drawArrays(gl.TRIANGLES, 0, this._data._vertCount);
        glDrawCalls++;
        glTriangles += (this._data._vertCount / 3) | 0;
    };
    PCRenderObject.prototype.draw = PCRenderObject.prototype.render;
    global.RenderObject = PCRenderObject;

    global.Render = {
        CULL_FACE_NONE: 0,
        PL_DEFAULT: 0,
        init: function () { initWebGLProgram(); },
        setView: function (fov, near, far) {
            mat4Perspective(projMat, fov || 60.0, 640 / 448, near || 0.25, far || 52.0);
        },
        begin: function () {
            if (!gl || !initWebGLProgram()) return;
            glDrawCalls = 0;
            glTriangles = 0;
            gl.viewport(0, 0, glCanvas.width, glCanvas.height);
            gl.clearColor(glClearR, glClearG, glClearB, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.useProgram(glProg);
            gl.uniformMatrix4fv(glProg.uProj, false, projMat);
            gl.uniform3fv(glProg.uL0Dir, lights[0].dir);
            gl.uniform3fv(glProg.uL0Amb, lights[0].amb);
            gl.uniform3fv(glProg.uL0Diff, lights[0].diff);
            gl.uniform3fv(glProg.uL1Dir, lights[1].dir);
            gl.uniform3fv(glProg.uL1Amb, lights[1].amb);
            gl.uniform3fv(glProg.uL1Diff, lights[1].diff);
            gl.uniform3f(glProg.uFogCol, glClearR, glClearG, glClearB);
        },
        stats: function () { return { drawCalls: glDrawCalls, triangles: glTriangles }; }
    };

    global.Camera = {
        LOOKAT: 1,
        type: function () {},
        target: function (x, y, z) { camTgt[0] = x; camTgt[1] = y; camTgt[2] = z; },
        position: function (x, y, z) { camPos[0] = x; camPos[1] = y; camPos[2] = z; },
        update: function () {
            if (!gl || !glProg) return;
            mat4LookAt(viewMat, camPos, camTgt);
            gl.uniformMatrix4fv(glProg.uView, false, viewMat);
        }
    };

    let nextLightId = 0;
    global.Lights = {
        DIRECTION: 1, AMBIENT: 2, DIFFUSE: 3,
        new: function () { return (nextLightId++) & 3; },
        set: function (id, prop, x, y, z) {
            const L = lights[id & 3];
            if (!L) return;
            if (prop === 1) { L.dir[0] = x; L.dir[1] = y; L.dir[2] = z; }
            else if (prop === 2) { L.amb[0] = x; L.amb[1] = y; L.amb[2] = z; }
            else if (prop === 3) { L.diff[0] = x; L.diff[1] = y; L.diff[2] = z; }
        }
    };

    // ========================================================================
    // SCREEN & 2D OVERLAY
    // ========================================================================
    let fpsNow = 60, fpsFrames = 0, fpsLast = performance.now();
    global.Z16S = 1;
    global.Screen = {
        Z16S: 1,
        DEPTH_TEST_ENABLE: 1, DEPTH_TEST_METHOD: 2, DEPTH_GEQUAL: 3, DEPTH_ALWAYS: 4,
        ALPHA_TEST_ENABLE: 5, DST_ALPHA_TEST_ENABLE: 6, SCISSOR_BOUNDS: 7,
        VRAM_USED_TOTAL: 1, VRAM_SIZE: 2,
        getMode: function () { return { width: 640, height: 448, zbuffering: true, psmz: 1 }; },
        setMode: function () {},
        setVSync: function () {},
        setFrameCounter: function () {},
        setParam: function () {},
        clearColor: function (c) {
            const u = c >>> 0;
            glClearR = (u & 255) / 255.0;
            glClearG = ((u >>> 8) & 255) / 255.0;
            glClearB = ((u >>> 16) & 255) / 255.0;
        },
        clear: function () {
            ctx.clearRect(0, 0, canvas2d.width, canvas2d.height);
            if (gl) {
                gl.clearColor(glClearR, glClearG, glClearB, 1.0);
                gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            }
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
                    ctx.fillStyle = "rgba(26,5,5,0.92)";
                    ctx.fillRect(0, 0, 640, 448);
                    ctx.fillStyle = "#ff8080";
                    ctx.font = "14px monospace";
                    ctx.fillText("PC 3D Runtime Error: " + String(err), 16, 28);
                    console.error(err);
                }
                requestAnimationFrame(frame);
            }
            requestAnimationFrame(frame);
        }
    };

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
            ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3);
            ctx.closePath(); ctx.fill();
        },
        quad: function (x1, y1, x2, y2, x3, y3, x4, y4, c1) {
            ctx.fillStyle = colToCss(c1);
            ctx.beginPath();
            ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4);
            ctx.closePath(); ctx.fill();
        }
    };

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

    const NativeImage = global.Image;
    function PCImage(path) {
        this._img = new NativeImage();
        this._ready = false;
        this._onReadyCallbacks = [];
        this.width = 256;
        this.height = 256;
        this.color = global.Color.new(128, 128, 128, 128);
        const self = this;
        this._img.onload = function () {
            self._ready = true;
            if (!self._customW) self.width = self._img.naturalWidth || 256;
            if (!self._customH) self.height = self._img.naturalHeight || 256;
            for (let i = 0; i < self._onReadyCallbacks.length; i++) self._onReadyCallbacks[i]();
            self._onReadyCallbacks.length = 0;
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
    PCImage.prototype.free = function () { this._ready = false; };
    global.Image = PCImage;

    // ========================================================================
    // SOUND (HTML5 Audio)
    // ========================================================================
    let masterVol = 0.75;
    const activeStreams = [];
    let audioUnlocked = false;
    function unlockAudio() {
        if (audioUnlocked) return;
        audioUnlocked = true;
        for (let i = 0; i < activeStreams.length; i++) {
            const st = activeStreams[i];
            if (st._wantPlay && st._el.paused) st._el.play().catch(function () {});
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
    PCStream.prototype.pause = function () { this._wantPlay = false; this._el.pause(); };
    PCStream.prototype.rewind = function () { try { this._el.currentTime = 0; } catch (_) {} };
    PCStream.prototype.playing = function () { return !this._el.paused && !this._el.ended; };

    function PCSfx() {}
    PCSfx.prototype.play = function () {};
    global.Sound = {
        Stream: PCStream,
        Sfx: PCSfx,
        setVolume: function (v) {
            masterVol = Math.max(0, Math.min(1, (v || 0) / 100.0));
            for (let i = 0; i < activeStreams.length; i++) activeStreams[i]._el.volume = masterVol;
        }
    };

    // ========================================================================
    // CONTROLES NATIVOS DE PC: MOUSE (CÁMARA 3D) + TECLADO WASD + GAMEPAD
    // ========================================================================
    const P = {
        SELECT: 1 << 0, START: 1 << 3,
        UP: 1 << 4, RIGHT: 1 << 5, DOWN: 1 << 6, LEFT: 1 << 7,
        L2: 1 << 8, R2: 1 << 9, L1: 1 << 10, R1: 1 << 11,
        TRIANGLE: 1 << 12, CIRCLE: 1 << 13, CROSS: 1 << 14, SQUARE: 1 << 15,
        STATE_FINDCTP1: 5, STATE_STABLE: 6
    };
    const keysDown = {};
    let mouseDX = 0, mouseDY = 0;
    let mouseLeft = false, mouseRight = false, mouseDragging = false;

    window.addEventListener("keydown", function (e) {
        keysDown[e.code] = true;
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab"].indexOf(e.code) !== -1) {
            e.preventDefault();
        }
    });
    window.addEventListener("keyup", function (e) { keysDown[e.code] = false; });

    canvas2d.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    canvas2d.addEventListener("mousedown", function (e) {
        if (document.pointerLockElement !== canvas2d && canvas2d.requestPointerLock) {
            try { canvas2d.requestPointerLock(); } catch (_) {}
        }
        if (e.button === 0) { mouseLeft = true; mouseDragging = true; }
        if (e.button === 2) { mouseRight = true; }
    });
    window.addEventListener("mouseup", function (e) {
        if (e.button === 0) { mouseLeft = false; mouseDragging = false; }
        if (e.button === 2) { mouseRight = false; }
    });
    window.addEventListener("mousemove", function (e) {
        if (document.pointerLockElement === canvas2d || mouseDragging) {
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

            // Teclado WASD (analógico suave + D-Pad para menús)
            let ax = 0, ay = 0;
            if (keysDown.KeyW) ay -= 127;
            if (keysDown.KeyS) ay += 127;
            if (keysDown.KeyA) ax -= 127;
            if (keysDown.KeyD) ax += 127;
            if (keysDown.ArrowUp) mask |= P.UP;
            if (keysDown.ArrowDown) mask |= P.DOWN;
            if (keysDown.ArrowLeft) mask |= P.LEFT;
            if (keysDown.ArrowRight) mask |= P.RIGHT;
            if (keysDown.KeyW && !keysDown.KeyS) mask |= P.UP;
            if (keysDown.KeyS && !keysDown.KeyW) mask |= P.DOWN;
            if (keysDown.KeyA && !keysDown.KeyD) mask |= P.LEFT;
            if (keysDown.KeyD && !keysDown.KeyA) mask |= P.RIGHT;

            if (keysDown.KeyE || keysDown.Enter || keysDown.Space || mouseLeft) mask |= P.CROSS;
            if (keysDown.ShiftLeft || keysDown.ShiftRight || keysDown.Backspace) mask |= P.CIRCLE;
            if (keysDown.KeyC || keysDown.ControlLeft) mask |= P.SQUARE;
            if (keysDown.KeyF || mouseRight) mask |= P.TRIANGLE;
            if (keysDown.KeyG || keysDown.KeyQ) mask |= P.L2;
            if (keysDown.F3) mask |= P.R2;
            if (keysDown.Tab || keysDown.KeyM) mask |= P.SELECT;
            if (keysDown.Escape || keysDown.KeyP) mask |= P.START;

            this.lx = ax;
            this.ly = ay;
            // Mouse mueve la cámara 3D con sensibilidad calibrada (horizontal + vertical)
            this.rx = Math.max(-127, Math.min(127, (mouseDX * 14) | 0));
            this.ry = Math.max(-127, Math.min(127, (mouseDY * 14) | 0));
            mouseDX = 0;
            mouseDY = 0;

            const gps = navigator.getGamepads ? navigator.getGamepads() : [];
            const gp = gps && gps[0];
            if (gp) {
                if (Math.abs(gp.axes[0]) > 0.15) this.lx = (gp.axes[0] * 127) | 0;
                if (Math.abs(gp.axes[1]) > 0.15) this.ly = (gp.axes[1] * 127) | 0;
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
