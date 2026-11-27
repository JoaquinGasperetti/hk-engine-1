// ============================================================================
// HK Engine 1 Studio — Editor Visual (Map Editor, Script Editor, Live 3D Play)
// ============================================================================
const state = {
  projects: [],
  activeProjPath: "",
  project: null,
  maps: [],
  scripts: [],
  modelAssets: [],
  activeMapName: "",
  mapData: null,
  activeScriptName: "",
  selectedEntityIdx: -1,
  tool: { mode: "tile", val: 1 },
  painting: false,
  playActive: false,
  playPlayer: null,
  playKeys: {},
  targetPlatform: "pc",
  previewAssetPath: ""
};

const PALETTE = [
  { mode: "tile", val: 0, label: "Libre",       color: "#141822" },
  { mode: "tile", val: 1, label: "Muro A",      color: "#606c7c" },
  { mode: "tile", val: 2, label: "Muro B",      color: "#86583e" },
  { mode: "tile", val: 3, label: "Muro C",      color: "#842a30" },
  { mode: "tile", val: 4, label: "Salida",      color: "#3ea86c" },
  { mode: "tile", val: 5, label: "Puerta/Reja", color: "#989256" },
  { mode: "ent",  val: "spawn",  label: "Spawn",       color: "#22c55e" },
  { mode: "ent",  val: "item",   label: "Item",        color: "#f59e0b" },
  { mode: "ent",  val: "switch", label: "Interruptor", color: "#14b8a6" },
  { mode: "ent",  val: "npc",    label: "NPC",         color: "#38bdf8" },
  { mode: "ent",  val: "enemy",  label: "Enemigo",     color: "#ef4444" }
];

const TILE_COLORS = ["#121620", "#64748b", "#9a6343", "#992e36", "#22c55e", "#b5a642"];
const ENT_COLORS  = { item: "#f59e0b", switch: "#14b8a6", npc: "#38bdf8", enemy: "#ef4444" };

function log(msg) {
  const out = document.getElementById("console-out");
  const ts = new Date().toLocaleTimeString();
  out.textContent += `[${ts}] ${msg}\n`;
  out.scrollTop = out.scrollHeight;
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[ch]);
}

function setTargetPlatform(platform) {
  state.targetPlatform = platform === "ps2" ? "ps2" : "pc";
  localStorage.setItem("hk_target_platform", state.targetPlatform);
  updateTargetBadge();
  if (state.project) {
    state.project.targetPlatform = state.targetPlatform;
    state.project.targetPS2 = true;
    state.project.targetPC = true;
    state.project.rendererProfile = state.targetPlatform === "ps2" ? "athena-vu1" : "webgl-high";
    state.project.graphicsProfile = state.targetPlatform === "ps2" ? "subsuelo04" : "pc-high";
  }
  document.getElementById("platform-chooser").hidden = true;
  log(`Entorno configurado para ${state.targetPlatform === "ps2" ? "PlayStation 2 · AthenaEnv V4 · perfil Subsuelo04" : "PC · WebGL de alta calidad"}.`);
}

function updateTargetBadge() {
  const button = document.getElementById("btn-target");
  if (!button) return;
  document.body.dataset.target = state.targetPlatform;
  button.textContent = state.targetPlatform === "ps2" ? "Perfil: PS2" : "Perfil: PC";
  button.classList.toggle("ps2-target", state.targetPlatform === "ps2");
  const ps2Export = document.getElementById("btn-export-ps2");
  const pcExport = document.getElementById("btn-export-pc");
  if (ps2Export && pcExport) {
    ps2Export.classList.toggle("target-export", state.targetPlatform === "ps2");
    pcExport.classList.toggle("target-export", state.targetPlatform === "pc");
  }
  updateBudgetBadge();
}

function openPlatformChooser() {
  document.getElementById("platform-chooser").hidden = false;
}

async function api(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || "Error API");
  return data;
}

function buildPalette() {
  const bar = document.getElementById("palette-bar");
  bar.innerHTML = "";
  PALETTE.forEach((p, idx) => {
    const btn = document.createElement("button");
    btn.className = "pal-btn" + (idx === 1 ? " active" : "");
    btn.innerHTML = `<span class="swatch" style="background:${p.color}"></span>${p.label}`;
    btn.onclick = () => {
      state.tool = { mode: p.mode, val: p.val };
      bar.querySelectorAll(".pal-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    };
    bar.appendChild(btn);
  });
}

function estimateTris(grid) {
  if (!grid) return 0;
  let faces = 0;
  const h = grid.length, w = grid[0].length;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (grid[y][x] === 0) { faces += 2; continue; }
      if (x > 0 && grid[y][x - 1] === 0) faces++;
      if (x + 1 < w && grid[y][x + 1] === 0) faces++;
      if (y > 0 && grid[y - 1][x] === 0) faces++;
      if (y + 1 < h && grid[y + 1][x] === 0) faces++;
    }
  }
  return Math.round(faces * 1.15);
}

function drawMapCanvas() {
  const cv = document.getElementById("map-canvas");
  const ctx = cv.getContext("2d");
  if (!state.mapData) return;
  const grid = state.mapData.grid;
  const rows = grid.length, cols = grid[0].length;
  const cell = Math.floor(Math.min(cv.width / cols, cv.height / rows));
  ctx.clearRect(0, 0, cv.width, cv.height);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      ctx.fillStyle = TILE_COLORS[grid[y][x]] || TILE_COLORS[1];
      ctx.fillRect(x * cell, y * cell, cell - 1, cell - 1);
    }
  }

  // Spawn del jugador
  const sp = state.mapData.spawn || { x: 2.5, y: 2.5 };
  ctx.fillStyle = "#22c55e";
  ctx.beginPath();
  ctx.arc(sp.x * cell, sp.y * cell, cell * 0.30, 0, Math.PI * 2);
  ctx.fill();

  // Entidades
  (state.mapData.entities || []).forEach((e, idx) => {
    ctx.fillStyle = ENT_COLORS[e.kind] || "#facc15";
    ctx.beginPath();
    ctx.arc(e.x * cell, e.y * cell, cell * 0.28, 0, Math.PI * 2);
    ctx.fill();
    if (idx === state.selectedEntityIdx) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });

  updateBudgetBadge();
}

function updateBudgetBadge() {
  const badge = document.getElementById("ps2-budget");
  if (!badge) return;
  badge.textContent = state.targetPlatform === "ps2"
    ? `PS2 Est.: ~${estimateTris(state.mapData && state.mapData.grid)} tris`
    : "PC · WebGL · Modelos 3D";
}

function renderLists() {
  const ml = document.getElementById("map-list");
  ml.innerHTML = "";
  state.maps.forEach(m => {
    const li = document.createElement("li");
    li.className = m === state.activeMapName ? "active" : "";
    li.innerHTML = `<span>${m}.json</span><span class="tree-tag">MAP</span>`;
    li.onclick = () => loadMap(m);
    ml.appendChild(li);
  });

  const sl = document.getElementById("script-list");
  sl.innerHTML = "";
  state.scripts.forEach(s => {
    const li = document.createElement("li");
    li.className = s === state.activeScriptName ? "active" : "";
    li.innerHTML = `<span>${s}</span><span class="tree-tag">JS</span>`;
    li.onclick = () => { loadScript(s); switchTab("script"); };
    sl.appendChild(li);
  });

  const models = document.getElementById("model-list");
  models.innerHTML = "";
  document.getElementById("model-count").textContent = String(state.modelAssets.length);
  state.modelAssets.forEach(path => {
    const li = document.createElement("li");
    li.title = "Asignar a la entidad seleccionada";
    const name = document.createElement("span");
    name.textContent = path.split("/").pop();
    const tag = document.createElement("span");
    tag.className = "tree-tag";
    tag.textContent = "OBJ";
    li.append(name, tag);
    li.onclick = () => {
      const entity = state.mapData && state.mapData.entities && state.mapData.entities[state.selectedEntityIdx];
      if (!entity) { log("Seleccioná una entidad y después elegí el modelo OBJ."); return; }
      entity.model = path;
      renderEntityInspector();
      log(`Modelo asignado: ${path}`);
    };
    models.appendChild(li);
  });

  const el = document.getElementById("entity-list");
  el.innerHTML = "";
  ((state.mapData && state.mapData.entities) || []).forEach((e, idx) => {
    const li = document.createElement("li");
    li.className = idx === state.selectedEntityIdx ? "active" : "";
    li.innerHTML = `<span>${e.label || e.kind}</span><span class="tree-tag">${e.kind.toUpperCase()}</span>`;
    li.onclick = () => { state.selectedEntityIdx = idx; renderLists(); renderEntityInspector(); drawMapCanvas(); };
    el.appendChild(li);
  });
}

function renderEntityInspector() {
  const box = document.getElementById("entity-inspector");
  const ents = (state.mapData && state.mapData.entities) || [];
  const e = ents[state.selectedEntityIdx];
  if (!e) {
    box.innerHTML = '<div class="muted-note">Selecciona una entidad en la lista o coloca una en el mapa.</div>';
    return;
  }
  box.innerHTML = `
    <label>Tipo<input id="ent-kind" value="${escapeHtml(e.kind)}" readonly></label>
    <label>Etiqueta<input id="ent-label" value="${escapeHtml(e.label || "")}"></label>
    <label>Dialogo / Nota<input id="ent-dialog" value="${escapeHtml(e.dialog || "")}"></label>
    <label>Modelo 3D (ruta OBJ)<input id="ent-model" value="${escapeHtml(e.model || "")}" placeholder="assets/models/mi_modelo.obj"></label>
    <div class="row-3">
      <label>Escala<input id="ent-model-scale" type="number" step="0.05" min="0.05" value="${escapeHtml(e.modelScale || 0.55)}"></label>
      <label>Giro Y (rad)<input id="ent-model-rotation" type="number" step="0.1" value="${escapeHtml(e.rotationY || 0)}"></label>
      <label>Altura<input id="ent-model-y" type="number" step="0.1" value="${escapeHtml(e.modelY || 0)}"></label>
    </div>
    <div class="row-3">
      <label>X<input id="ent-x" type="number" step="0.5" value="${escapeHtml(e.x)}"></label>
      <label>Y<input id="ent-y" type="number" step="0.5" value="${escapeHtml(e.y)}"></label>
      <label>&nbsp;<button id="btn-del-ent" class="mini-btn" style="border-color:#ef4444;color:#fca5a5;">Borrar</button></label>
    </div>
  `;
  document.getElementById("ent-label").oninput = ev => { e.label = ev.target.value; renderLists(); };
  document.getElementById("ent-dialog").oninput = ev => { e.dialog = ev.target.value; };
  document.getElementById("ent-model").onchange = ev => { e.model = ev.target.value.trim(); };
  document.getElementById("ent-model-scale").oninput = ev => { e.modelScale = Math.max(0.05, parseFloat(ev.target.value) || 0.55); };
  document.getElementById("ent-model-rotation").oninput = ev => { e.rotationY = parseFloat(ev.target.value) || 0; };
  document.getElementById("ent-model-y").oninput = ev => { e.modelY = parseFloat(ev.target.value) || 0; };
  document.getElementById("ent-x").oninput = ev => { e.x = parseFloat(ev.target.value) || 1.5; drawMapCanvas(); };
  document.getElementById("ent-y").oninput = ev => { e.y = parseFloat(ev.target.value) || 1.5; drawMapCanvas(); };
  document.getElementById("btn-del-ent").onclick = () => {
    ents.splice(state.selectedEntityIdx, 1);
    state.selectedEntityIdx = -1;
    renderLists(); renderEntityInspector(); drawMapCanvas();
  };
}

function syncInspectorFields() {
  if (state.project) {
    document.getElementById("inp-proj-name").value = state.project.name || "";
    document.getElementById("inp-proj-genre").value = state.project.genre || "";
    document.getElementById("inp-proj-author").value = state.project.author || "";
  }
  if (state.mapData) {
    const a = state.mapData.atmosphere || { clearR: 8, clearG: 10, clearB: 16, lightMul: 1.0 };
    document.getElementById("inp-map-name").value = state.mapData.name || "";
    document.getElementById("inp-atmo-r").value = a.clearR;
    document.getElementById("inp-atmo-g").value = a.clearG;
    document.getElementById("inp-atmo-b").value = a.clearB;
    document.getElementById("inp-atmo-light").value = a.lightMul;
  }
}

async function loadProject(path) {
  state.activeProjPath = path;
  state.previewAssetPath = "";
  const data = await api(`/api/project?path=${encodeURIComponent(path)}`);
  state.project = data.project;
  state.modelAssets = data.models || [];
  if (state.project.targetPlatform === "pc" || state.project.targetPlatform === "ps2") {
    state.targetPlatform = state.project.targetPlatform;
    localStorage.setItem("hk_target_platform", state.targetPlatform);
    updateTargetBadge();
  }
  state.maps = data.maps;
  state.scripts = data.scripts;
  state.selectedEntityIdx = -1;
  syncInspectorFields();
  if (state.maps.length) await loadMap(state.maps[0]);
  if (state.scripts.length) await loadScript(state.scripts[0]);
  log(`Proyecto cargado: ${state.project.name} (${path})`);
}

async function loadMap(name) {
  state.activeMapName = name;
  const data = await api(`/api/map?path=${encodeURIComponent(state.activeProjPath)}&name=${encodeURIComponent(name)}`);
  state.mapData = data.map;
  state.selectedEntityIdx = -1;
  syncInspectorFields();
  renderLists();
  renderEntityInspector();
  drawMapCanvas();
}

async function loadScript(name) {
  state.activeScriptName = name;
  const data = await api(`/api/script?path=${encodeURIComponent(state.activeProjPath)}&name=${encodeURIComponent(name)}`);
  document.getElementById("active-script-name").textContent = `${data.folder || "scripts"}/${name}`;
  document.getElementById("script-editor").value = data.code;
  renderLists();
}

async function saveAll() {
  state.project.name = document.getElementById("inp-proj-name").value;
  state.project.genre = document.getElementById("inp-proj-genre").value;
  state.project.author = document.getElementById("inp-proj-author").value;
  state.project.targetPlatform = state.targetPlatform;
  state.project.targetPS2 = true;
  state.project.targetPC = true;
  state.project.rendererProfile = state.targetPlatform === "ps2" ? "athena-vu1" : "webgl-high";
  state.project.graphicsProfile = state.targetPlatform === "ps2" ? "subsuelo04" : "pc-high";
  state.mapData.name = document.getElementById("inp-map-name").value;
  state.mapData.atmosphere = {
    clearR: parseInt(document.getElementById("inp-atmo-r").value, 10) || 8,
    clearG: parseInt(document.getElementById("inp-atmo-g").value, 10) || 10,
    clearB: parseInt(document.getElementById("inp-atmo-b").value, 10) || 16,
    lightMul: parseFloat(document.getElementById("inp-atmo-light").value) || 1.0
  };
  await api("/api/save-project", { method: "POST", body: JSON.stringify({ path: state.activeProjPath, project: state.project }) });
  await api("/api/save-map", { method: "POST", body: JSON.stringify({ path: state.activeProjPath, name: state.activeMapName, map: state.mapData }) });
  await api("/api/save-script", { method: "POST", body: JSON.stringify({ path: state.activeProjPath, name: state.activeScriptName, code: document.getElementById("script-editor").value }) });
  log("Cambios guardados en disco (project.json, mapa y script).");
}

function applyCanvasTool(ev) {
  if (!state.mapData) return;
  const cv = document.getElementById("map-canvas");
  const rect = cv.getBoundingClientRect();
  const grid = state.mapData.grid;
  const rows = grid.length, cols = grid[0].length;
  const cell = Math.floor(Math.min(cv.width / cols, cv.height / rows));
  const gx = Math.floor(((ev.clientX - rect.left) * (cv.width / rect.width)) / cell);
  const gy = Math.floor(((ev.clientY - rect.top) * (cv.height / rect.height)) / cell);
  if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) return;

  if (state.tool.mode === "tile") {
    grid[gy][gx] = state.tool.val;
    drawMapCanvas();
  } else if (!state.painting) {
    if (grid[gy][gx] !== 0) { log("Coloca entidades solo sobre celdas libres (0)."); return; }
    if (state.tool.val === "spawn") {
      state.mapData.spawn = { x: gx + 0.5, y: gy + 0.5, ang: -1.5708 };
    } else {
      state.mapData.entities = state.mapData.entities || [];
      state.mapData.entities.push({ kind: state.tool.val, x: gx + 0.5, y: gy + 0.5, label: state.tool.val.toUpperCase(), dialog: "" });
      state.selectedEntityIdx = state.mapData.entities.length - 1;
      renderLists();
      renderEntityInspector();
    }
    drawMapCanvas();
  }
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === "tab-" + name));
  state.playActive = (name === "play");
  if (state.playActive) initPlayPreview();
}

// Vista previa 3D interactiva en vivo dentro del editor
function initPlayPreview() {
  if (!state.mapData) return;
  const sp = state.mapData.spawn || { x: 2.5, y: 2.5, ang: 0 };
  state.playPlayer = { x: sp.x, y: sp.y, ang: sp.ang || 0, crouched: false, lightOn: true };
  loadPreviewAssets().catch(e => log("ERROR cargando recursos para la vista 3D: " + e.message));
}

async function loadPreviewAssets() {
  if (!state.activeProjPath || state.previewAssetPath === state.activeProjPath || typeof HKPCRenderer === "undefined") return;
  const data = await api(`/api/assets?path=${encodeURIComponent(state.activeProjPath)}`);
  const base = `/api/project-asset?path=${encodeURIComponent(state.activeProjPath)}&file=`;
  HKPCRenderer.setAssetSources(data.objFiles || {}, base);
  HKPCRenderer.init("play-gl-canvas");
  state.previewAssetPath = state.activeProjPath;
}

function tickPlayPreview() {
  if (state.playActive && state.mapData && state.playPlayer) {
    const pl = state.playPlayer;
    const grid = state.mapData.grid;
    const k = state.playKeys;
    const spd = pl.crouched ? 0.04 : 0.07;
    if (k.ArrowLeft) pl.ang -= 0.05;
    if (k.ArrowRight) pl.ang += 0.05;
    const fwd = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    const str = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    const dx = (Math.cos(pl.ang) * fwd - Math.sin(pl.ang) * str) * spd;
    const dy = (Math.sin(pl.ang) * fwd + Math.cos(pl.ang) * str) * spd;
    const nx = pl.x + dx, ny = pl.y + dy;
    if (grid[Math.floor(pl.y)] && grid[Math.floor(pl.y)][Math.floor(nx)] === 0) pl.x = nx;
    if (grid[Math.floor(ny)] && grid[Math.floor(ny)][Math.floor(pl.x)] === 0) pl.y = ny;

    const previewScene = {
      id: state.activeMapName,
      grid: grid,
      atmosphere: state.mapData.atmosphere,
      entities: state.mapData.entities || [],
      player: { x: pl.x, y: pl.y, ang: pl.ang, eyeH: pl.crouched ? 1.04 : 1.55, lightOn: pl.lightOn }
    };
    if (typeof HKPCRenderer !== "undefined" && HKPCRenderer.renderScene(previewScene)) {
      const overlay = document.getElementById("play-canvas");
      const overlayCtx = overlay.getContext("2d");
      overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
      overlayCtx.fillStyle = "rgba(6, 8, 14, 0.76)";
      overlayCtx.fillRect(14, 14, 360, 32);
      overlayCtx.fillStyle = "#facc15";
      overlayCtx.font = "600 15px monospace";
      overlayCtx.fillText(`${state.mapData.name} | ${pl.crouched ? "SIGILO" : "DE PIE"} | PC WEBGL`, 24, 35);
      requestAnimationFrame(tickPlayPreview);
      return;
    }

    const cv = document.getElementById("play-canvas");
    const ctx = cv.getContext("2d");
    const w = cv.width, h = cv.height;
    const atmo = state.mapData.atmosphere || { clearR: 8, clearG: 10, clearB: 16, lightMul: 1.0 };
    const horizon = (h >> 1) + (pl.crouched ? -22 : 0);
    ctx.fillStyle = `rgb(${atmo.clearR + 8},${atmo.clearG + 10},${atmo.clearB + 14})`;
    ctx.fillRect(0, 0, w, horizon);
    ctx.fillStyle = `rgb(${atmo.clearR + 20},${atmo.clearG + 20},${atmo.clearB + 24})`;
    ctx.fillRect(0, horizon, w, h - horizon);

    const rays = 128, colW = Math.ceil(w / rays);
    const wCols = [[0,0,0],[96,108,124],[134,88,62],[132,42,48],[62,168,108],[152,146,86]];
    const lMul = pl.lightOn ? (atmo.lightMul || 1.0) : 0.35;
    for (let i = 0; i < rays; i++) {
      const rayAng = pl.ang + ((2 * i / rays) - 1) * 0.52;
      const rdx = Math.cos(rayAng), rdy = Math.sin(rayAng);
      let mx = Math.floor(pl.x), my = Math.floor(pl.y);
      const dX = Math.abs(1 / (rdx || 1e-5)), dY = Math.abs(1 / (rdy || 1e-5));
      let sX = rdx < 0 ? -1 : 1, sY = rdy < 0 ? -1 : 1;
      let sideX = rdx < 0 ? (pl.x - mx) * dX : (mx + 1 - pl.x) * dX;
      let sideY = rdy < 0 ? (pl.y - my) * dY : (my + 1 - pl.y) * dY;
      let hit = 0, side = 0, g = 0;
      while (hit === 0 && g < 26) {
        g++;
        if (sideX < sideY) { sideX += dX; mx += sX; side = 0; } else { sideY += dY; my += sY; side = 1; }
        if (!grid[my] || grid[my][mx] === undefined) { hit = 1; break; }
        hit = grid[my][mx];
      }
      const dist = Math.max(0.12, ((side === 0 ? sideX - dX : sideY - dY)) * Math.cos(rayAng - pl.ang));
      const lh = Math.min(h * 2, Math.floor(h / dist));
      const b = wCols[hit] || wCols[1];
      const fog = Math.max(0.12, Math.min(1, 1 - dist / 14)) * (side ? 0.78 : 1) * lMul;
      ctx.fillStyle = `rgb(${Math.min(255, b[0]*fog+atmo.clearR*(1-fog))|0},${Math.min(255, b[1]*fog+atmo.clearG*(1-fog))|0},${Math.min(255, b[2]*fog+atmo.clearB*(1-fog))|0})`;
      ctx.fillRect(i * colW, horizon - (lh >> 1), colW, lh);
    }
    ctx.fillStyle = "rgba(6,8,14,0.75)";
    ctx.fillRect(12, 12, 240, 26);
    ctx.fillStyle = "#facc15";
    ctx.font = "600 13px monospace";
    ctx.fillText(`${state.mapData.name} | ${pl.crouched ? "SIGILO" : "DE PIE"}`, 20, 29);
  }
  requestAnimationFrame(tickPlayPreview);
}

async function boot() {
  state.targetPlatform = localStorage.getItem("hk_target_platform") || "pc";
  updateTargetBadge();
  buildPalette();
  const data = await api("/api/projects");
  state.projects = data.projects;
  const sel = document.getElementById("project-select");
  sel.innerHTML = "";
  state.projects.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.path;
    const tag = p.kind === "external" ? (p.mode === "modular" ? "PS2 MODULAR" : "EXTERNO") : (p.kind === "project" ? "PROYECTO" : "PLANTILLA");
    opt.textContent = `[${tag}] ${p.name}`;
    sel.appendChild(opt);
  });
  sel.onchange = () => loadProject(sel.value);
  if (state.projects.length) await loadProject(state.projects[0].path);

  const cv = document.getElementById("map-canvas");
  cv.onmousedown = ev => { state.painting = false; applyCanvasTool(ev); state.painting = true; };
  cv.onmousemove = ev => { if (state.painting && state.tool.mode === "tile") applyCanvasTool(ev); };
  window.addEventListener("mouseup", () => { state.painting = false; });

  document.querySelectorAll(".tab").forEach(t => { t.onclick = () => switchTab(t.dataset.tab); });
  document.getElementById("btn-save").onclick = () => saveAll().catch(e => log("ERROR: " + e.message));
  document.getElementById("btn-play").onclick = () => switchTab("play");
  document.getElementById("btn-target").onclick = openPlatformChooser;
  document.querySelectorAll("[data-platform]").forEach(btn => {
    btn.onclick = () => setTargetPlatform(btn.dataset.platform);
  });
  document.getElementById("btn-import-model").onclick = () => document.getElementById("model-files").click();
  document.getElementById("model-files").onchange = async ev => {
    const files = Array.from(ev.target.files || []);
    for (const file of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
        }
        const result = await api("/api/import-asset", { method: "POST", body: JSON.stringify({ path: state.activeProjPath, filename: file.name, data: btoa(binary) }) });
        state.previewAssetPath = "";
        if (file.name.toLowerCase().endsWith(".obj")) {
          state.modelAssets.push(result.path);
          state.modelAssets.sort();
          renderLists();
        }
        log(`Recurso importado: ${result.path}`);
      } catch (e) { log(`ERROR importando ${file.name}: ${e.message}`); }
    }
    ev.target.value = "";
  };
  document.getElementById("btn-reset-play").onclick = initPlayPreview;
  document.getElementById("btn-clear-log").onclick = () => { document.getElementById("console-out").textContent = ""; };

  document.getElementById("btn-open-folder").onclick = async () => {
    const folder = prompt("Ruta completa de la carpeta del proyecto (ej: C:\\proyectos\\mi_juego o /home/user/mi_juego):");
    if (!folder) return;
    try {
      const r = await api("/api/open-folder", { method: "POST", body: JSON.stringify({ folder }) });
      log(`Proyecto externo vinculado (${r.mode}): ${r.path}`);
      await boot();
      sel.value = r.path;
      await loadProject(r.path);
    } catch (e) { log("ERROR: " + e.message); }
  };

  document.getElementById("btn-new-proj").onclick = async () => {
    const name = prompt("Nombre del nuevo juego:", state.targetPlatform === "ps2" ? "Mi Juego PS2" : "Mi Juego PC");
    if (!name) return;
    try {
      const r = await api("/api/new-project", { method: "POST", body: JSON.stringify({ name, slug: name, template: state.activeProjPath, targetPlatform: state.targetPlatform }) });
      log(`Nuevo proyecto creado en ${r.path}`);
      await boot();
      sel.value = r.path;
      await loadProject(r.path);
    } catch (e) { log("ERROR: " + e.message); }
  };

  document.getElementById("btn-add-map").onclick = async () => {
    const name = prompt("Nombre del nuevo mapa (ej: level_02):", `level_0${state.maps.length + 1}`);
    if (!name) return;
    const blank = Array.from({ length: 12 }, (_, y) => Array.from({ length: 12 }, (_, x) => (y === 0 || y === 11 || x === 0 || x === 11 ? 1 : 0)));
    await api("/api/save-map", { method: "POST", body: JSON.stringify({ path: state.activeProjPath, name, map: { name, spawn: { x: 2.5, y: 2.5, ang: 0 }, atmosphere: { clearR: 10, clearG: 12, clearB: 18, lightMul: 1.0 }, grid: blank, entities: [] } }) });
    await loadProject(state.activeProjPath);
    await loadMap(name);
    log(`Mapa ${name}.json creado.`);
  };

  document.getElementById("btn-export-ps2").onclick = async () => {
    await saveAll();
    log("Compilando exportacion PlayStation 2...");
    const r = await api("/api/export-ps2", { method: "POST", body: JSON.stringify({ path: state.activeProjPath }) });
    log(r.stdout || r.stderr);
  };

  document.getElementById("btn-export-pc").onclick = async () => {
    await saveAll();
    log("Compilando exportacion PC (.exe)...");
    const r = await api("/api/export-pc", { method: "POST", body: JSON.stringify({ path: state.activeProjPath }) });
    log(r.stdout || r.stderr);
  };

  const SNIPPETS = {
    onInit: "\n// Se ejecuta al cargar un mapa\n// onInit: function (engine, scene) { engine.notify('Nivel iniciado', 120); },\n",
    onUpdate: "\n// Se ejecuta en cada frame (60 FPS NTSC / 50 FPS PAL)\n// onUpdate: function (engine, scene, dtMs, dtScale) {},\n",
    onInteract: "\n// Se ejecuta al pulsar X (PS2) o E (PC) frente a una entidad\n// onInteract: function (engine, scene, entity) {},\n",
    onDrawHUD: "\n// Dibuja elementos 2D extra sobre el HUD\n// onDrawHUD: function (engine, scene, w, h) {},\n"
  };
  document.querySelectorAll("[data-snippet]").forEach(btn => {
    btn.onclick = () => {
      const ed = document.getElementById("script-editor");
      ed.value += SNIPPETS[btn.dataset.snippet] || "";
    };
  });

  window.addEventListener("keydown", ev => {
    state.playKeys[ev.code] = true;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") { ev.preventDefault(); saveAll(); }
    if (state.playActive && ev.code === "KeyC" && state.playPlayer) state.playPlayer.crouched = !state.playPlayer.crouched;
    if (state.playActive && ev.code === "KeyF" && state.playPlayer) state.playPlayer.lightOn = !state.playPlayer.lightOn;
  });
  window.addEventListener("keyup", ev => { state.playKeys[ev.code] = false; });

  requestAnimationFrame(tickPlayPreview);
}

boot().catch(e => log("ERROR DE ARRANQUE: " + e.message));
