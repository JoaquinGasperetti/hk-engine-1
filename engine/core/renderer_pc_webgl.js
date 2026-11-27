// HK Engine PC renderer: WebGL scene renderer with textured grid geometry and OBJ assets.
// WebGL 1 keeps the runtime compatible with ordinary desktop browsers and WebView shells.
const HKPCRenderer = (function () {
    "use strict";

    const CELL = 2.0;
    const WALL_H = 2.6;
    const STRIDE = 12;
    const ASSET_TEXT = window.HK_OBJ_FILES || {};
    const textures = Object.create(null);
    const modelCache = Object.create(null);
    const tileColors = {
        0: [0.82, 0.86, 0.90, 1],
        1: [1, 1, 1, 1], 2: [1, 1, 1, 1], 3: [1, 1, 1, 1],
        4: [1, 1, 1, 1], 5: [1, 1, 1, 1]
    };
    const tileTextures = {
        floor: "assets/textures/floor.png",
        ceiling: "assets/textures/ceiling.png",
        1: "assets/textures/wall_concrete.png",
        2: "assets/textures/wall_rust.png",
        3: "assets/textures/wall_ritual.png",
        4: "assets/textures/exit_door.png",
        5: "assets/textures/gate.png"
    };
    const kinds = {
        item: [0.97, 0.61, 0.12, 1], switch: [0.08, 0.75, 0.61, 1],
        npc: [0.16, 0.70, 0.96, 1], enemy: [0.91, 0.14, 0.18, 1]
    };

    let gl = null;
    let initFailed = false;
    let canvas = null;
    let program = null;
    let attrib = null;
    let uniform = null;
    let whiteTexture = null;
    let worldKey = "";
    let worldMeshes = [];
    let editorGridMesh = null;
    let editorGridKey = "";
    let selectionMesh = null;
    let cubeMesh = null;
    let assetBase = window.HK_ASSET_BASE || "";
    let drawCalls = 0;
    let triangles = 0;

    function compileShader(type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const message = gl.getShaderInfoLog(shader) || "Shader compile failed";
            gl.deleteShader(shader);
            throw new Error(message);
        }
        return shader;
    }

    function initProgram() {
        const vertexSource = [
            "attribute vec3 aPosition;",
            "attribute vec3 aNormal;",
            "attribute vec2 aUv;",
            "attribute vec4 aColor;",
            "uniform mat4 uMvp;",
            "uniform mat4 uView;",
            "uniform mat4 uModel;",
            "uniform mat3 uNormalMatrix;",
            "varying vec3 vNormal;",
            "varying vec2 vUv;",
            "varying vec4 vColor;",
            "varying float vDepth;",
            "void main(){ vec4 p=vec4(aPosition,1.0); gl_Position=uMvp*p; vNormal=normalize(uNormalMatrix*aNormal); vUv=aUv; vColor=aColor; vDepth=-(uView*uModel*p).z; }"
        ].join("\n");
        const fragmentSource = [
            "precision mediump float;",
            "uniform sampler2D uTexture;",
            "uniform bool uUseTexture;",
            "uniform vec4 uTint;",
            "uniform vec3 uLightDir;",
            "uniform vec3 uAmbient;",
            "uniform vec3 uFogColor;",
            "uniform float uFogNear;",
            "uniform float uFogFar;",
            "varying vec3 vNormal;",
            "varying vec2 vUv;",
            "varying vec4 vColor;",
            "varying float vDepth;",
            "void main(){ vec4 tex=uUseTexture?texture2D(uTexture,vUv):vec4(1.0); float d=max(dot(normalize(vNormal),normalize(-uLightDir)),0.0); vec3 lit=uAmbient+vec3(d*0.78); vec4 base=tex*vColor*uTint; vec3 rgb=base.rgb*lit; float fog=clamp((vDepth-uFogNear)/(uFogFar-uFogNear),0.0,1.0); gl_FragColor=vec4(mix(rgb,uFogColor,fog),base.a); }"
        ].join("\n");
        const vs = compileShader(gl.VERTEX_SHADER, vertexSource);
        const fs = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
        program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "WebGL link failed");
        attrib = {
            position: gl.getAttribLocation(program, "aPosition"),
            normal: gl.getAttribLocation(program, "aNormal"),
            uv: gl.getAttribLocation(program, "aUv"),
            color: gl.getAttribLocation(program, "aColor")
        };
        uniform = {
            mvp: gl.getUniformLocation(program, "uMvp"), view: gl.getUniformLocation(program, "uView"), model: gl.getUniformLocation(program, "uModel"),
            normal: gl.getUniformLocation(program, "uNormalMatrix"), texture: gl.getUniformLocation(program, "uTexture"),
            useTexture: gl.getUniformLocation(program, "uUseTexture"), tint: gl.getUniformLocation(program, "uTint"), light: gl.getUniformLocation(program, "uLightDir"),
            ambient: gl.getUniformLocation(program, "uAmbient"), fogColor: gl.getUniformLocation(program, "uFogColor"),
            fogNear: gl.getUniformLocation(program, "uFogNear"), fogFar: gl.getUniformLocation(program, "uFogFar")
        };
    }

    function init(canvasId) {
        const requestedCanvas = document.getElementById(canvasId || "hk-gl-canvas");
        if (!requestedCanvas) return false;
        if (canvas === requestedCanvas && gl && program) return true;
        canvas = requestedCanvas;
        if (initFailed) return false;
        gl = canvas.getContext("webgl", { alpha: false, antialias: true, depth: true, powerPreference: "high-performance" }) ||
             canvas.getContext("experimental-webgl", { alpha: false, antialias: true, depth: true });
        if (!gl) { initFailed = true; return false; }
        try { initProgram(); } catch (error) {
            console.error("HK Engine WebGL renderer:", error);
            initFailed = true;
            gl = null;
            return false;
        }
        whiteTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, whiteTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.CULL_FACE);
        return true;
    }

    function appendVertex(out, p, n, uv, color) {
        out.push(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1], color[0], color[1], color[2], color[3]);
    }

    function appendQuad(out, p, n, color, uvScale) {
        const uv = uvScale || 1;
        const order = [0, 1, 2, 0, 2, 3];
        const tex = [[0, 0], [uv, 0], [uv, 1], [0, 1]];
        for (let i = 0; i < order.length; i++) appendVertex(out, p[order[i]], n, tex[order[i]], color);
    }

    function addWorldMesh(buckets, key, p, n, color, uvScale) {
        if (!buckets[key]) buckets[key] = [];
        appendQuad(buckets[key], p, n, color, uvScale);
    }

    function makeGpuMesh(data, texturePath) {
        if (!data || !data.length) return null;
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
        return { buffer: buffer, count: data.length / STRIDE, texture: texturePath || "" };
    }

    function releaseMeshes(meshes) {
        for (let i = 0; i < meshes.length; i++) if (meshes[i].buffer) gl.deleteBuffer(meshes[i].buffer);
    }

    function buildWorld(grid, includeCeiling) {
        if (includeCeiling === undefined) includeCeiling = true;
        const buckets = Object.create(null);
        const h = grid.length, w = grid[0] ? grid[0].length : 0;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (grid[y][x] !== 0) continue;
                const x0 = x * CELL, x1 = (x + 1) * CELL, z0 = y * CELL, z1 = (y + 1) * CELL;
                addWorldMesh(buckets, "floor", [[x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0]], [0, 1, 0], tileColors[0], 1);
                if (includeCeiling) addWorldMesh(buckets, "ceiling", [[x0, WALL_H, z0], [x0, WALL_H, z1], [x1, WALL_H, z1], [x1, WALL_H, z0]], [0, -1, 0], tileColors[0], 1);
            }
        }
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const type = grid[y][x] | 0;
                if (type <= 0) continue;
                const x0 = x * CELL, x1 = (x + 1) * CELL, z0 = y * CELL, z1 = (y + 1) * CELL;
                const color = tileColors[type] || tileColors[1];
                const visible = (nx, ny) => !grid[ny] || grid[ny][nx] === undefined || grid[ny][nx] === 0;
                if (!includeCeiling) addWorldMesh(buckets, "wall" + type, [[x0, WALL_H, z0], [x1, WALL_H, z0], [x1, WALL_H, z1], [x0, WALL_H, z1]], [0, 1, 0], color, 1);
                if (visible(x, y - 1)) addWorldMesh(buckets, "wall" + type, [[x0, 0, z0], [x1, 0, z0], [x1, WALL_H, z0], [x0, WALL_H, z0]], [0, 0, -1], color, 1);
                if (visible(x + 1, y)) addWorldMesh(buckets, "wall" + type, [[x1, 0, z0], [x1, 0, z1], [x1, WALL_H, z1], [x1, WALL_H, z0]], [1, 0, 0], color, 1);
                if (visible(x, y + 1)) addWorldMesh(buckets, "wall" + type, [[x1, 0, z1], [x0, 0, z1], [x0, WALL_H, z1], [x1, WALL_H, z1]], [0, 0, 1], color, 1);
                if (visible(x - 1, y)) addWorldMesh(buckets, "wall" + type, [[x0, 0, z1], [x0, 0, z0], [x0, WALL_H, z0], [x0, WALL_H, z1]], [-1, 0, 0], color, 1);
            }
        }
        const meshes = [];
        for (const key in buckets) {
            const textureKey = key === "floor" || key === "ceiling" ? key : Number(key.slice(4));
            const mesh = makeGpuMesh(buckets[key], tileTextures[textureKey]);
            if (mesh) meshes.push(mesh);
        }
        return meshes;
    }

    function hashGrid(grid) {
        let hash = 2166136261;
        for (let y = 0; y < grid.length; y++) {
            const row = grid[y] || [];
            hash = Math.imul(hash ^ row.length, 16777619);
            for (let x = 0; x < row.length; x++) hash = Math.imul(hash ^ (row[x] | 0), 16777619);
        }
        return grid.length + ":" + hash;
    }

    function makeEditorGrid(grid) {
        const rows = grid.length, cols = grid[0] ? grid[0].length : 0;
        const out = [];
        const color = [0.14, 0.19, 0.25, 1];
        function line(x0, z0, x1, z1) {
            appendVertex(out, [x0, 0.025, z0], [0, 1, 0], [0, 0], color);
            appendVertex(out, [x1, 0.025, z1], [0, 1, 0], [0, 0], color);
        }
        for (let x = 0; x <= cols; x++) line(x * CELL, 0, x * CELL, rows * CELL);
        for (let z = 0; z <= rows; z++) line(0, z * CELL, cols * CELL, z * CELL);
        const mesh = makeGpuMesh(out, "");
        if (mesh) mesh.primitive = gl.LINES;
        return mesh;
    }

    function makeSelectionFrame() {
        const out = [];
        const points = [
            [-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 1, -0.5], [-0.5, 1, -0.5],
            [-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5]
        ];
        const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
        const color = [1, 0.76, 0.18, 1];
        for (let i = 0; i < edges.length; i++) {
            appendVertex(out, points[edges[i][0]], [0, 1, 0], [0, 0], color);
            appendVertex(out, points[edges[i][1]], [0, 1, 0], [0, 0], color);
        }
        const mesh = makeGpuMesh(out, "");
        if (mesh) mesh.primitive = gl.LINES;
        return mesh;
    }

    function matrixIdentity() {
        return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    }

    function matrixMultiply(a, b) {
        const out = new Float32Array(16);
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
            out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
        }
        return out;
    }

    function perspective(fov, aspect, near, far) {
        const f = 1 / Math.tan(fov * Math.PI / 360), nf = 1 / (near - far);
        const out = new Float32Array(16);
        out[0] = f / aspect; out[5] = f; out[10] = (far + near) * nf; out[11] = -1; out[14] = 2 * far * near * nf;
        return out;
    }

    function lookAt(eye, center) {
        let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
        let len = Math.hypot(zx, zy, zz) || 1; zx /= len; zy /= len; zz /= len;
        let xx = zz, xy = 0, xz = -zx;
        len = Math.hypot(xx, xz) || 1; xx /= len; xz /= len;
        const yx = zy * xz, yy = zz * xx - zx * xz, yz = -zy * xx;
        return new Float32Array([
            xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
            -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
            -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
            -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1
        ]);
    }

    function modelMatrix(position, rotationY, scale) {
        const c = Math.cos(rotationY || 0), s = Math.sin(rotationY || 0);
        const sx = scale && scale.x !== undefined ? scale.x : 1;
        const sy = scale && scale.y !== undefined ? scale.y : sx;
        const sz = scale && scale.z !== undefined ? scale.z : sx;
        return new Float32Array([c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0, position[0], position[1], position[2], 1]);
    }

    function normalMatrix(rotationY) {
        const c = Math.cos(rotationY || 0), s = Math.sin(rotationY || 0);
        return new Float32Array([c, 0, -s, 0, 1, 0, s, 0, c]);
    }

    function normalizeAssetPath(path) {
        return String(path || "").replace(/\\/g, "/").replace(/^\.\//, "");
    }

    function loadTexture(path) {
        const key = normalizeAssetPath(path);
        if (!key || !gl) return whiteTexture;
        if (textures[key]) return textures[key];
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([180, 180, 180, 255]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        const image = new Image();
        image.onload = function () {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            const powerOfTwo = (n) => (n & (n - 1)) === 0;
            if (powerOfTwo(image.width) && powerOfTwo(image.height)) {
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                gl.generateMipmap(gl.TEXTURE_2D);
            } else {
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            }
        };
        image.onerror = function () { console.warn("HK Engine: textura no encontrada:", key); };
        image.src = assetBase ? assetBase + encodeURIComponent(key) : key;
        textures[key] = texture;
        return texture;
    }

    function parseMtl(path) {
        const source = ASSET_TEXT[path] || "";
        const out = Object.create(null);
        let current = null;
        const lines = source.split(/\r?\n/);
        const parent = path.slice(0, path.lastIndexOf("/") + 1);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line[0] === "#") continue;
            const words = line.split(/\s+/);
            if (words[0] === "newmtl") { current = out[words[1]] = { color: [1, 1, 1, 1], texture: "" }; }
            else if (current && words[0] === "Kd" && words.length >= 4) current.color = [Number(words[1]), Number(words[2]), Number(words[3]), 1];
            else if (current && words[0] === "map_Kd") {
                const file = words[words.length - 1];
                current.texture = normalizeAssetPath(parent + file);
            }
        }
        return out;
    }

    function parseObj(path) {
        const source = ASSET_TEXT[path];
        if (!source) return null;
        const positions = [[0, 0, 0]], uvs = [[0, 0]], normals = [[0, 1, 0]];
        const materialFiles = [];
        const lines = source.split(/\r?\n/);
        const parent = path.slice(0, path.lastIndexOf("/") + 1);
        let currentMaterial = "default";
        const faces = Object.create(null);
        function bucket(name) { if (!faces[name]) faces[name] = []; return faces[name]; }
        for (let li = 0; li < lines.length; li++) {
            const line = lines[li].trim();
            if (!line || line[0] === "#") continue;
            const parts = line.split(/\s+/);
            if (parts[0] === "v" && parts.length >= 4) positions.push([+parts[1], +parts[2], +parts[3]]);
            else if (parts[0] === "vt" && parts.length >= 3) uvs.push([+parts[1], +parts[2]]);
            else if (parts[0] === "vn" && parts.length >= 4) normals.push([+parts[1], +parts[2], +parts[3]]);
            else if (parts[0] === "mtllib" && parts.length > 1) for (let mi = 1; mi < parts.length; mi++) materialFiles.push(normalizeAssetPath(parent + parts[mi]));
            else if (parts[0] === "usemtl" && parts.length > 1) currentMaterial = parts.slice(1).join(" ");
            else if (parts[0] === "f" && parts.length >= 4) {
                const face = [];
                for (let fi = 1; fi < parts.length; fi++) {
                    const indexes = parts[fi].split("/");
                    const resolve = (value, length) => { const n = parseInt(value, 10); return n < 0 ? length + n : n; };
                    face.push({ p: resolve(indexes[0], positions.length), t: indexes[1] ? resolve(indexes[1], uvs.length) : 0, n: indexes[2] ? resolve(indexes[2], normals.length) : 0 });
                }
                for (let fi = 1; fi + 1 < face.length; fi++) {
                    const tri = [face[0], face[fi], face[fi + 1]];
                    const p0 = positions[tri[0].p], p1 = positions[tri[1].p], p2 = positions[tri[2].p];
                    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
                    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
                    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
                    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
                    const out = bucket(currentMaterial);
                    for (let vi = 0; vi < 3; vi++) {
                        const v = tri[vi], pos = positions[v.p] || [0, 0, 0], uv = uvs[v.t] || [0, 0], norm = normals[v.n] || [nx, ny, nz];
                        out.push(pos[0], pos[1], pos[2], norm[0], norm[1], norm[2], uv[0], uv[1], 1, 1, 1, 1);
                    }
                }
            }
        }
        const materials = Object.create(null);
        for (let mi = 0; mi < materialFiles.length; mi++) Object.assign(materials, parseMtl(materialFiles[mi]));
        const meshes = [];
        for (const name in faces) {
            const mat = materials[name] || { color: [1, 1, 1, 1], texture: "" };
            const data = faces[name];
            for (let vi = 0; vi < data.length; vi += STRIDE) {
                data[vi + 8] *= mat.color[0]; data[vi + 9] *= mat.color[1]; data[vi + 10] *= mat.color[2];
            }
            const mesh = makeGpuMesh(data, mat.texture);
            if (mesh) meshes.push(mesh);
        }
        return meshes;
    }

    function getModel(path) {
        const key = normalizeAssetPath(path);
        if (!key) return null;
        if (!Object.prototype.hasOwnProperty.call(modelCache, key)) modelCache[key] = parseObj(key);
        return modelCache[key];
    }

    function makeCube() {
        if (cubeMesh) return cubeMesh;
        const out = [];
        const faces = [
            { p: [[-.5, 0, -.5], [.5, 0, -.5], [.5, 1, -.5], [-.5, 1, -.5]], n: [0, 0, -1] },
            { p: [[.5, 0, -.5], [.5, 0, .5], [.5, 1, .5], [.5, 1, -.5]], n: [1, 0, 0] },
            { p: [[.5, 0, .5], [-.5, 0, .5], [-.5, 1, .5], [.5, 1, .5]], n: [0, 0, 1] },
            { p: [[-.5, 0, .5], [-.5, 0, -.5], [-.5, 1, -.5], [-.5, 1, .5]], n: [-1, 0, 0] },
            { p: [[-.5, 1, -.5], [.5, 1, -.5], [.5, 1, .5], [-.5, 1, .5]], n: [0, 1, 0] },
            { p: [[-.5, 0, .5], [.5, 0, .5], [.5, 0, -.5], [-.5, 0, -.5]], n: [0, -1, 0] }
        ];
        for (let i = 0; i < faces.length; i++) appendQuad(out, faces[i].p, faces[i].n, [1, 1, 1, 1], 1);
        cubeMesh = makeGpuMesh(out, "");
        return cubeMesh;
    }

    function bindMesh(mesh, model, view, projection, fogColor, ambient, lightDir, tint) {
        if (!mesh || !mesh.buffer) return;
        const mvp = matrixMultiply(projection, matrixMultiply(view, model));
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
        gl.enableVertexAttribArray(attrib.position); gl.vertexAttribPointer(attrib.position, 3, gl.FLOAT, false, STRIDE * 4, 0);
        gl.enableVertexAttribArray(attrib.normal); gl.vertexAttribPointer(attrib.normal, 3, gl.FLOAT, false, STRIDE * 4, 3 * 4);
        gl.enableVertexAttribArray(attrib.uv); gl.vertexAttribPointer(attrib.uv, 2, gl.FLOAT, false, STRIDE * 4, 6 * 4);
        gl.enableVertexAttribArray(attrib.color); gl.vertexAttribPointer(attrib.color, 4, gl.FLOAT, false, STRIDE * 4, 8 * 4);
        gl.uniformMatrix4fv(uniform.mvp, false, mvp);
        gl.uniformMatrix4fv(uniform.view, false, view);
        gl.uniformMatrix4fv(uniform.model, false, model);
        const yaw = Math.atan2(model[8], model[0]);
        gl.uniformMatrix3fv(uniform.normal, false, normalMatrix(yaw));
        gl.uniform3fv(uniform.light, lightDir);
        gl.uniform3fv(uniform.ambient, ambient);
        gl.uniform3fv(uniform.fogColor, fogColor);
        gl.uniform4fv(uniform.tint, tint || [1, 1, 1, 1]);
        gl.uniform1f(uniform.fogNear, 9.0);
        gl.uniform1f(uniform.fogFar, 38.0);
        const useTexture = !!mesh.texture;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, useTexture ? loadTexture(mesh.texture) : whiteTexture);
        gl.uniform1i(uniform.texture, 0);
        gl.uniform1i(uniform.useTexture, useTexture ? 1 : 0);
        gl.drawArrays(mesh.primitive || gl.TRIANGLES, 0, mesh.count);
        drawCalls++;
        if (mesh.primitive !== gl.LINES) triangles += mesh.count / 3;
    }

    function renderScene(scene) {
        if (!gl && !init()) return false;
        if (!scene || !scene.grid || !scene.grid.length) return false;
        const gridKey = hashGrid(scene.grid) + ":runtime";
        if (gridKey !== worldKey) {
            releaseMeshes(worldMeshes);
            worldMeshes = buildWorld(scene.grid, true);
            worldKey = gridKey;
        }
        const atmo = scene.atmosphere || { clearR: 8, clearG: 10, clearB: 16 };
        const fog = [atmo.clearR / 255, atmo.clearG / 255, atmo.clearB / 255];
        const player = scene.player || { x: 2.5, y: 2.5, ang: 0, eyeH: 1.55 };
        const yaw = player.ang || 0;
        const eye = [player.x * CELL, player.eyeH || 1.55, player.y * CELL];
        const pitch = player.pitchY || 0;
        const target = [eye[0] + Math.cos(yaw) * Math.cos(pitch), eye[1] + Math.sin(pitch), eye[2] + Math.sin(yaw) * Math.cos(pitch)];
        const view = lookAt(eye, target);
        const projection = perspective(68, (canvas.width || 960) / (canvas.height || 540), 0.12, 56.0);
        const identity = matrixIdentity();
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(fog[0], fog[1], fog[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(program);
        gl.uniformMatrix4fv(uniform.view, false, view);
        gl.uniform1i(uniform.texture, 0);
        drawCalls = 0; triangles = 0;
        const ambient = player.lightOn === false ? [0.16, 0.17, 0.20] : [0.37, 0.39, 0.43];
        const lightDir = [0.35, -1.0, 0.25];
        for (let i = 0; i < worldMeshes.length; i++) bindMesh(worldMeshes[i], identity, view, projection, fog, ambient, lightDir);
        const cube = makeCube();
        const ents = scene.entities || [];
        for (let i = 0; i < ents.length; i++) {
            const e = ents[i];
            if (e.taken) continue;
            const model = e.model ? getModel(e.model) : null;
            const pos = [e.x * CELL, 0, e.y * CELL];
            let transform;
            if (model && model.length) {
                const scale = Number(e.modelScale) > 0 ? Number(e.modelScale) : 0.55;
                pos[1] = Number(e.modelY) || 0;
                transform = modelMatrix(pos, Number(e.rotationY) || 0, { x: scale, y: scale, z: scale });
                for (let mi = 0; mi < model.length; mi++) bindMesh(model[mi], transform, view, projection, fog, ambient, lightDir);
            } else {
                transform = modelMatrix([pos[0], 0, pos[2]], 0, { x: 0.62, y: 1.20, z: 0.62 });
                const color = kinds[e.kind] || [0.84, 0.84, 0.86, 1];
                bindMesh(cube, transform, view, projection, fog, ambient, lightDir, color);
            }
        }
        return true;
    }

    function renderEditorScene(map, camera, selectedIndex) {
        if (!gl && !init("play-gl-canvas")) return false;
        if (!map || !map.grid || !map.grid.length) return false;
        const grid = map.grid;
        const gridKey = hashGrid(grid) + ":editor";
        if (gridKey !== worldKey) {
            releaseMeshes(worldMeshes);
            worldMeshes = buildWorld(grid, false);
            worldKey = gridKey;
        }
        const gridSizeKey = grid.length + ":" + (grid[0] ? grid[0].length : 0);
        if (gridSizeKey !== editorGridKey) {
            if (editorGridMesh) releaseMeshes([editorGridMesh]);
            editorGridMesh = makeEditorGrid(grid);
            editorGridKey = gridSizeKey;
        }
        if (!selectionMesh) selectionMesh = makeSelectionFrame();

        const rows = grid.length, cols = grid[0] ? grid[0].length : 0;
        const viewCamera = camera || {};
        const target = viewCamera.target || [cols * CELL * 0.5, 0, rows * CELL * 0.5];
        const yaw = Number(viewCamera.yaw) || 0.72;
        const pitch = Math.max(0.12, Math.min(1.43, Number(viewCamera.pitch) || 0.76));
        const distance = Math.max(3, Number(viewCamera.distance) || Math.max(cols, rows) * CELL * 1.25);
        const horizontal = Math.cos(pitch) * distance;
        const eye = [target[0] + Math.sin(yaw) * horizontal, target[1] + Math.sin(pitch) * distance, target[2] + Math.cos(yaw) * horizontal];
        const view = lookAt(eye, target);
        const projection = perspective(52, (canvas.width || 960) / (canvas.height || 540), 0.12, Math.max(180, distance * 5));
        const fog = [12 / 255, 16 / 255, 23 / 255];
        const identity = matrixIdentity();
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(fog[0], fog[1], fog[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(program);
        gl.uniformMatrix4fv(uniform.view, false, view);
        gl.uniform1i(uniform.texture, 0);
        drawCalls = 0; triangles = 0;
        const ambient = [0.49, 0.51, 0.55];
        const lightDir = [0.35, -1.0, 0.25];
        for (let i = 0; i < worldMeshes.length; i++) bindMesh(worldMeshes[i], identity, view, projection, fog, ambient, lightDir);
        if (editorGridMesh) bindMesh(editorGridMesh, identity, view, projection, fog, ambient, lightDir);

        const spawn = map.spawn || { x: 2.5, y: 2.5 };
        const cube = makeCube();
        const spawnModel = modelMatrix([spawn.x * CELL, 0.025, spawn.y * CELL], Number(spawn.ang) || 0, { x: 0.36, y: 0.12, z: 0.36 });
        bindMesh(cube, spawnModel, view, projection, fog, ambient, lightDir, [0.13, 0.85, 0.45, 1]);

        const entities = map.entities || [];
        for (let i = 0; i < entities.length; i++) {
            const entity = entities[i];
            const selected = i === selectedIndex;
            const position = [entity.x * CELL, Number(entity.modelY) || 0, entity.y * CELL];
            const model = entity.model ? getModel(entity.model) : null;
            const scale = Number(entity.modelScale) > 0 ? Number(entity.modelScale) : 0.55;
            const transform = modelMatrix(position, Number(entity.rotationY) || 0, { x: model && model.length ? scale : 0.68, y: model && model.length ? scale : 1.12, z: model && model.length ? scale : 0.68 });
            if (model && model.length) {
                const tint = selected ? [1.22, 0.91, 0.36, 1] : [1, 1, 1, 1];
                for (let mi = 0; mi < model.length; mi++) bindMesh(model[mi], transform, view, projection, fog, ambient, lightDir, tint);
            } else {
                const color = selected ? [1, 0.67, 0.16, 1] : (kinds[entity.kind] || [0.84, 0.84, 0.86, 1]);
                bindMesh(cube, transform, view, projection, fog, ambient, lightDir, color);
            }
            if (selected && selectionMesh) {
                const frame = modelMatrix([position[0], position[1], position[2]], Number(entity.rotationY) || 0, { x: model && model.length ? scale * 1.18 : 0.82, y: model && model.length ? scale * 1.18 : 1.34, z: model && model.length ? scale * 1.18 : 0.82 });
                bindMesh(selectionMesh, frame, view, projection, fog, ambient, lightDir, [1, 0.76, 0.18, 1]);
            }
        }
        return true;
    }

    function setAssetSources(objFiles, baseUrl) {
        for (const key in ASSET_TEXT) delete ASSET_TEXT[key];
        Object.assign(ASSET_TEXT, objFiles || {});
        assetBase = baseUrl || "";
        for (const key in modelCache) {
            const meshes = modelCache[key];
            if (meshes) releaseMeshes(meshes);
            delete modelCache[key];
        }
        for (const key in textures) {
            if (textures[key] && gl) gl.deleteTexture(textures[key]);
            delete textures[key];
        }
        if (worldMeshes.length) releaseMeshes(worldMeshes);
        if (editorGridMesh) releaseMeshes([editorGridMesh]);
        if (selectionMesh) releaseMeshes([selectionMesh]);
        editorGridMesh = null; editorGridKey = ""; selectionMesh = null;
        worldMeshes = [];
        worldKey = "";
    }

    return { init: init, renderScene: renderScene, renderEditorScene: renderEditorScene, setAssetSources: setAssetSources, getStats: function () { return { drawCalls: drawCalls, triangles: triangles }; } };
})();
