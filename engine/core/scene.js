// ============================================================================
// HK Engine 1 — Scene & Game Loop Manager
// ============================================================================
const HKEngine = {
    project: null,
    maps: {},
    scene: null,
    input: {
        moveX: 0, moveY: 0, lookX: 0, lookY: 0,
        confirm: false, cancel: false, sprint: false, crouch: false,
        action: false, secondary: false, map: false, pause: false, debug: false, startHeld: false
    },
    frameTick: 0,
    lastMs: Date.now(),
    state: "TITLE",
    hudMsg: "",
    hudMsgTimer: 0,
    userHooks: { onInit: null, onUpdate: null, onDrawHUD: null, onInteract: null },

    registerHooks: function (hooks) {
        this.userHooks = hooks || {};
    },

    loadMap: function (mapId) {
        const src = this.maps[mapId];
        if (!src) return false;
        const grid = [];
        for (let y = 0; y < src.grid.length; y++) grid.push(src.grid[y].slice());
        const ents = [];
        for (let i = 0; i < (src.entities || []).length; i++) {
            const e = src.entities[i];
            ents.push({
                kind: e.kind, x: toF64(e.x), y: toF64(e.y),
                label: e.label || e.kind.toUpperCase(),
                dialog: e.dialog || "",
                model: e.model || "",
                modelScale: e.modelScale || 0.55,
                modelY: e.modelY || 0,
                rotationY: e.rotationY || 0,
                taken: false
            });
        }
        const sp = src.spawn || { x: 2.5, y: 2.5, ang: 0.0 };
        this.scene = {
            id: mapId,
            name: src.name || mapId,
            grid: grid,
            atmosphere: src.atmosphere || { clearR: 8, clearG: 10, clearB: 16, lightMul: 1.0 },
            entities: ents,
            player: {
                x: toF64(sp.x), y: toF64(sp.y), ang: toF64(sp.ang || 0.0),
                vx: 0.0, vy: 0.0, turnVel: 0.0, pitchVel: 0.0,
                eyeH: 1.55, eyeBase: 1.55, lookPitch: 0.0, pitchY: 0.0,
                crouched: false, lightOn: true, stamina: 100.0, score: 0, items: 0
            },
            nearEntity: null
        };
        HKRenderer.initPS2Hardware(mapId);
        if (this.userHooks.onInit) this.userHooks.onInit(this, this.scene);
        return true;
    },

    notify: function (msg, frames) {
        this.hudMsg = String(msg);
        this.hudMsgTimer = frames || 150;
    },

    updateDefaultPlayer: function (dtScale) {
        const sc = this.scene;
        const pl = sc.player;
        const inp = this.input;

        if (inp.crouch) pl.crouched = !pl.crouched;
        if (inp.action) pl.lightOn = !pl.lightOn;

        // Giro horizontal + mirada vertical libre suave
        const turnSpd = 0.048;
        pl.turnVel = lerpF64(pl.turnVel, inp.lookX * turnSpd, Math.min(1.0, 0.36 * dtScale));
        pl.ang = fadd(pl.ang, pl.turnVel * dtScale);
        pl.pitchVel = lerpF64(pl.pitchVel, inp.lookY * turnSpd * 3.0, Math.min(1.0, 0.34 * dtScale));
        pl.lookPitch = clampF64(fadd(pl.lookPitch, pl.pitchVel * dtScale), -2.4, 2.4);

        const targetEye = pl.crouched ? 1.04 : 1.55;
        pl.eyeBase = lerpF64(pl.eyeBase, targetEye, Math.min(1.0, 0.22 * dtScale));
        pl.eyeH = pl.eyeBase;
        pl.pitchY = pl.lookPitch;

        const spd = inp.sprint && !pl.crouched ? 0.082 : (pl.crouched ? 0.030 : 0.052);
        const dirX = Math.cos(pl.ang);
        const dirY = Math.sin(pl.ang);
        const tvx = (dirX * inp.moveY - dirY * inp.moveX) * spd;
        const tvy = (dirY * inp.moveY + dirX * inp.moveX) * spd;
        pl.vx = lerpF64(pl.vx, tvx, Math.min(1.0, 0.28 * dtScale));
        pl.vy = lerpF64(pl.vy, tvy, Math.min(1.0, 0.28 * dtScale));

        pl.x = HKPhysics.moveAxis(sc.grid, pl.x, pl.y, pl.vx * dtScale, true, 0.24);
        pl.y = HKPhysics.moveAxis(sc.grid, pl.x, pl.y, pl.vy * dtScale, false, 0.24);

        // Detección de interacción contextual
        sc.nearEntity = null;
        let bestSq = 1.85;
        for (let i = 0; i < sc.entities.length; i++) {
            const e = sc.entities[i];
            if (e.taken) continue;
            const dx = pl.x - e.x;
            const dy = pl.y - e.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestSq) { bestSq = d2; sc.nearEntity = e; }
        }
        if (inp.confirm && sc.nearEntity) {
            if (this.userHooks.onInteract) {
                this.userHooks.onInteract(this, sc, sc.nearEntity);
            } else if (sc.nearEntity.kind === "item") {
                sc.nearEntity.taken = true;
                pl.items++;
                this.notify("Recogido: " + sc.nearEntity.label, 120);
            } else if (sc.nearEntity.kind === "npc") {
                this.notify(sc.nearEntity.dialog || sc.nearEntity.label, 200);
            }
        }
    },

    start: function (projectConfig, mapsDict) {
        this.project = projectConfig;
        this.maps = mapsDict || {};
        HKPlatform.init("hk-canvas");
        if (HKPlatform.name === "PC" && typeof HKPCRenderer !== "undefined") HKPCRenderer.init("hk-gl-canvas");
        this.loadMap(projectConfig.startMap || Object.keys(this.maps)[0]);
        const self = this;
        HKPlatform.runLoop(function () { self.tick(); });
    },

    tick: function () {
        this.frameTick++;
        const now = Date.now();
        const dtMs = clampF64(now - this.lastMs, 4.0, 100.0);
        this.lastMs = now;
        const dtScale = clampF64(dtMs / 16.6667, 0.5, 2.0);

        HKPlatform.readInput(this.input);
        const w = HKPlatform.screenW;
        const h = HKPlatform.screenH;

        if (this.state === "TITLE") {
            this.scene.player.ang += 0.004 * dtScale;
            HKRenderer.renderScene(this.scene, this.frameTick);
            HKPlatform.rect(0, 0, 310, h, rgba(6, 8, 14, 112));
            HKPlatform.rect(28, 86, 220, 2, rgba(20, 184, 166, 128));
            HKPlatform.text(28, 44, this.project.name || "HK GAME", 1.15, rgba(242, 245, 250, 128));
            HKPlatform.text(28, 96, this.project.genre || "HK ENGINE 1", 0.72, rgba(86, 224, 255, 128));
            HKPlatform.text(28, 178, "> INICIAR JUEGO", 0.80, rgba(250, 214, 96, 128));
            HKPlatform.text(28, h - 42, HKPlatform.name === "PS2" ? "[X / START] JUGAR" : "[ENTER / ESPACIO] JUGAR", 0.70, rgba(210, 220, 232, 128));
            if (this.input.confirm || this.input.pause) this.state = "PLAY";
            return;
        }

        this.updateDefaultPlayer(dtScale);
        if (this.userHooks.onUpdate) this.userHooks.onUpdate(this, this.scene, dtMs, dtScale);
        HKRenderer.renderScene(this.scene, this.frameTick);

        // HUD base + gancho del juego
        HKPlatform.rect(18, 14, w - 36, 32, rgba(6, 8, 14, 118));
        HKPlatform.text(28, 21, this.scene.name, 0.68, rgba(250, 214, 96, 128));
        HKPlatform.text(w - 170, 21, "ITEMS: " + this.scene.player.items, 0.68, rgba(86, 224, 255, 128));

        if (this.scene.nearEntity) {
            HKPlatform.rect((w >> 1) - 160, h - 74, 320, 30, rgba(8, 10, 16, 120));
            HKPlatform.text((w >> 1) - 146, h - 67, (HKPlatform.name === "PS2" ? "[X] " : "[E] ") + this.scene.nearEntity.label, 0.70, rgba(250, 220, 108, 128));
        }
        if (this.hudMsgTimer > 0) {
            this.hudMsgTimer--;
            HKPlatform.rect(18, h - 38, w - 36, 26, rgba(6, 10, 16, 118));
            HKPlatform.text(28, h - 33, this.hudMsg, 0.66, rgba(235, 240, 248, 128));
        }
        if (this.userHooks.onDrawHUD) this.userHooks.onDrawHUD(this, this.scene, w, h);
    }
};
