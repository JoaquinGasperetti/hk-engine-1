// ============================================================================
// HK Engine 1 — Unified 3D Renderer (VU1 Hardware on PS2 + WebGL on PC)
// Soporta atmósferas por mapa, mirada vertical libre, luz direccional y HUD.
// ============================================================================
const HKRenderer = {
    cellSize: 2.0,
    wallHeight: 2.6,
    eyeHeight: 1.55,
    vu1Ready: false,
    staticMeshes: [],
    texCache: {},
    wallColors: [
        [0, 0, 0],
        [96, 108, 124],   // 1: Muro A (hormigón / piedra)
        [134, 88, 62],    // 2: Muro B (metal / óxido)
        [132, 42, 48],    // 3: Muro C (acento / ritual / peligro)
        [62, 168, 108],   // 4: Salida / Portal
        [152, 146, 86]    // 5: Puerta / Reja
    ],

    initPS2Hardware: function (mapId) {
        if (HKPlatform.name !== "PS2") return false;
        if (typeof Render === "undefined" || typeof Render.init !== "function") return false;
        try {
            Render.init();
            Render.setView(60.0, 0.25, 52.0);
            if (typeof Camera.type === "function") Camera.type(Camera.LOOKAT);
            this.staticMeshes = [];
            const prefix = "assets/models/" + mapId + "_";
            const parts = [
                ["floor.obj", "floor.png"], ["ceiling.obj", "ceiling.png"],
                ["walls_1.obj", "wall_concrete.png"], ["walls_2.obj", "wall_rust.png"],
                ["walls_3.obj", "wall_ritual.png"], ["exit.obj", "exit_door.png"], ["gates.obj", "gate.png"]
            ];
            for (let i = 0; i < parts.length; i++) {
                const p = prefix + parts[i][0];
                if (!HKPlatform.fileExists(p)) continue;
                const texture = "assets/textures/" + parts[i][1];
                const data = hkFixProto(HKPlatform.fileExists(texture) ? new RenderData(p, texture) : new RenderData(p), RenderData);
                try { data.accurate_clipping = true; } catch (_) {}
                try { data.face_culling = Render.CULL_FACE_NONE; } catch (_) {}
                const obj = hkFixProto(new RenderObject(data), RenderObject);
                this.staticMeshes.push(obj);
            }
            this.vu1Ready = this.staticMeshes.length > 0;
        } catch (_) {
            this.vu1Ready = false;
        }
        return this.vu1Ready;
    },

    renderScene: function (scene, frameTick) {
        const atmo = scene.atmosphere || { clearR: 8, clearG: 10, clearB: 16, lightMul: 1.0 };
        HKPlatform.clearColor(atmo.clearR, atmo.clearG, atmo.clearB);

        const pcRendered = HKPlatform.name === "PC" && typeof HKPCRenderer !== "undefined" && HKPCRenderer.renderScene(scene, atmo, frameTick);
        if (pcRendered) {
            // PC WebGL renderer handled the 3D layer.
        } else if (HKPlatform.name === "PS2" && this.vu1Ready && HKPlatform.depthReady) {
            this.renderPS2VU1(scene, atmo);
        } else {
            this.renderSoftware3D(scene, atmo, frameTick);
        }
        HKPlatform.restore2D();
    },

    renderPS2VU1: function (scene, atmo) {
        const pl = scene.player;
        const dirX = Math.cos(pl.ang);
        const dirZ = Math.sin(pl.ang);
        const camX = pl.x * this.cellSize;
        const camY = pl.eyeH !== undefined ? pl.eyeH : this.eyeHeight;
        const camZ = pl.y * this.cellSize;
        const targetY = camY + (pl.pitchY || 0.0);

        try {
            Screen.setParam(Screen.DEPTH_TEST_METHOD, Screen.DEPTH_GEQUAL);
            Screen.setParam(Screen.DEPTH_TEST_ENABLE, true);
            Render.begin();
            Camera.target(camX + dirX * 4.0, targetY, camZ + dirZ * 4.0);
            Camera.position(camX, camY, camZ);
            Camera.update();
            for (let i = 0; i < this.staticMeshes.length; i++) {
                const o = this.staticMeshes[i];
                if (typeof o.render === "function") o.render();
                else if (typeof o.draw === "function") o.draw();
            }
        } finally {
            try { Screen.setParam(Screen.DEPTH_TEST_ENABLE, false); } catch (_) {}
        }
    },

    // Raycaster 3D ultra-rápido con pitch vertical, niebla atmosférica y sprites de entidades
    renderSoftware3D: function (scene, atmo, frameTick) {
        const w = HKPlatform.screenW;
        const h = HKPlatform.screenH;
        const grid = scene.grid;
        const pl = scene.player;
        const rays = 128;
        const colW = Math.ceil(w / rays);
        const fov = 1.05;
        const pitchPx = ((pl.pitchY || 0.0) * 42.0) | 0;
        const horizon = ((h >> 1) + pitchPx) | 0;
        const eyeBias = ((pl.eyeH - 1.55) * 32.0) | 0;
        const lightBoost = pl.lightOn ? (atmo.lightMul || 1.0) : 0.35;

        // Techo y piso con tono atmosférico
        HKPlatform.rect(0, 0, w, Math.max(0, horizon), rgba(atmo.clearR + 8, atmo.clearG + 10, atmo.clearB + 14, 128));
        HKPlatform.rect(0, Math.max(0, horizon), w, Math.max(0, h - horizon), rgba(atmo.clearR + 18, atmo.clearG + 18, atmo.clearB + 22, 128));

        const zBuf = new Float32Array(rays);

        for (let i = 0; i < rays; i++) {
            const camX = (2.0 * i / rays) - 1.0;
            const rayAng = pl.ang + camX * (fov * 0.5);
            const rdx = Math.cos(rayAng);
            const rdy = Math.sin(rayAng);

            let mapX = pl.x | 0;
            let mapY = pl.y | 0;
            const deltaX = Math.abs(1.0 / (rdx || 0.00001));
            const deltaY = Math.abs(1.0 / (rdy || 0.00001));
            let stepX = 1, stepY = 1;
            let sideX = 0, sideY = 0;

            if (rdx < 0) { stepX = -1; sideX = (pl.x - mapX) * deltaX; }
            else { sideX = (mapX + 1.0 - pl.x) * deltaX; }
            if (rdy < 0) { stepY = -1; sideY = (pl.y - mapY) * deltaY; }
            else { sideY = (mapY + 1.0 - pl.y) * deltaY; }

            let hit = 0, side = 0, guard = 0;
            while (hit === 0 && guard < 28) {
                guard++;
                if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; }
                else { sideY += deltaY; mapY += stepY; side = 1; }
                if (mapY < 0 || mapY >= grid.length || mapX < 0 || mapX >= grid[0].length) { hit = 1; break; }
                hit = grid[mapY][mapX];
            }

            const rawDist = (side === 0) ? (sideX - deltaX) : (sideY - deltaY);
            const perpDist = Math.max(0.12, rawDist * Math.cos(rayAng - pl.ang));
            zBuf[i] = perpDist;

            const lineH = Math.min(h * 2, (h / perpDist) | 0);
            const drawY = (horizon - (lineH >> 1) + eyeBias) | 0;
            const base = this.wallColors[hit] || this.wallColors[1];
            const fog = clampF64(1.0 - (perpDist / 14.0), 0.12, 1.0) * (side === 1 ? 0.78 : 1.0) * lightBoost;
            const cr = clampF64(base[0] * fog + atmo.clearR * (1.0 - fog), 0, 255) | 0;
            const cg = clampF64(base[1] * fog + atmo.clearG * (1.0 - fog), 0, 255) | 0;
            const cb = clampF64(base[2] * fog + atmo.clearB * (1.0 - fog), 0, 255) | 0;
            HKPlatform.rect(i * colW, drawY, colW, lineH, rgba(cr, cg, cb, 128));
        }

        // Proyección simple de entidades visibles (ítems, NPCs, enemigos)
        const dirX = Math.cos(pl.ang);
        const dirY = Math.sin(pl.ang);
        for (let eIdx = 0; eIdx < scene.entities.length; eIdx++) {
            const e = scene.entities[eIdx];
            if (e.taken) continue;
            const dx = e.x - pl.x;
            const dy = e.y - pl.y;
            const forward = dx * dirX + dy * dirY;
            if (forward < 0.25 || forward > 12.0) continue;
            const right = -dx * dirY + dy * dirX;
            const screenX = ((w * 0.5) + (right / forward) * (w * 0.65)) | 0;
            const rayIdx = clampF64((screenX / colW) | 0, 0, rays - 1) | 0;
            if (forward > zBuf[rayIdx] + 0.15) continue;

            const sprH = Math.min(h, ((h * 0.55) / forward) | 0);
            const sprW = Math.max(8, (sprH * 0.55) | 0);
            const bob = (e.kind === "item") ? ((Math.sin(frameTick * 0.08 + eIdx) * 5) | 0) : 0;
            const sy = (horizon + (sprH >> 2) - sprH + eyeBias + bob) | 0;
            let col = rgba(250, 212, 92, 128);
            if (e.kind === "enemy") col = rgba(235, 52, 58, 128);
            else if (e.kind === "npc") col = rgba(85, 224, 255, 128);
            else if (e.kind === "switch") col = rgba(92, 240, 138, 128);
            HKPlatform.rect(screenX - (sprW >> 1), sy, sprW, sprH, col);
        }
    }
};
