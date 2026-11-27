# HK Engine 1 — Motor 3D Multiplataforma (PlayStation 2 & PC)

**HK Engine 1** es un motor de videojuegos 3D ligero y modular desarrollado por **HK Entertainment**, diseñado para crear múltiples géneros en primera persona (*FPS*, *Survival Horror*, *Dungeon Crawler*, exploración y arcade 3D) y exportar el mismo proyecto tanto a **PlayStation 2 real** ([AthenaEnv V4](https://github.com/DanielSant0s/AthenaEnv)) como a **PC (app de escritorio / `.exe`)**.

Incluye **HK Engine 1 Studio**, un editor visual sin dependencias externas inspirado en Godot y Unity con Editor de Mapas 2D, Editor de Scripts, Inspector de Propiedades, Vista Previa 3D jugable en vivo y exportación en un clic.

---

## 1. Requisitos e inicio rápido

- **Python 3.9+** (solo biblioteca estándar para ejecutar el editor y los exportadores).
- *(Opcional para PS2 real / PCSX2)*: binario `athena.elf` de AthenaEnv V4 (`clean-api`).
- *(Opcional para compilar `.exe` en Windows)*: `pyinstaller` y `pywebview`.

### Abrir HK Engine 1 Studio

Desde la raíz del repositorio ejecutá:

```bash
python3 hk_studio.py
```

El editor se abrirá automáticamente en `http://127.0.0.1:8765`.

---

## 2. Estructura del repositorio

```text
hk-engine-1/
├── hk_studio.py                  # Servidor local y lanzador del IDE visual
├── editor/                       # Interfaz gráfica (Editor de Mapas, Scripts, Inspector, Play 3D)
│   ├── index.html
│   ├── studio.css
│   └── studio.js
├── engine/
│   ├── core/
│       ├── math.js               # Aritmética Float64 segura para MIPS (PS2 EE) y empaquetado RGBA
│       ├── platform_ps2.js       # Backend PlayStation 2 (AthenaEnv V4, DualShock 2, MC0)
│       ├── platform_pc.js        # Backend PC (Canvas, teclado/mouse, localStorage)
│       ├── physics.js            # Colisiones AABB con sub-stepping y línea de vista (LOS)
│       ├── renderer3d.js         # Pipeline VU1 (PS2) + selector de render por plataforma
│       ├── renderer_pc_webgl.js  # Escena WebGL PC, materiales/texturas y carga Wavefront OBJ/MTL
│       └── scene.js              # Bucle de juego, carga de mapas, movimiento orgánico y hooks
│   └── profiles/subsuelo04/      # Texturas base del perfil PS2 de HK Entertainment
├── tools/
│   ├── generate_meshes.py        # Compilador de mapas JSON → Wavefront .obj optimizados para PS2 GS
│   ├── build_ps2.py              # Exportador PlayStation 2 (main.js monolítico + .obj + configs OPL/ISO)
│   └── build_pc.py               # Exportador PC (bundle HTML5/Desktop + launcher_pc.py + build_exe.bat)
└── templates/                    # 3 plantillas listas para clonar en nuevos proyectos
    ├── fps_exploration/          # Exploración 3D con interruptor, compuertas, ítems y NPC
    ├── horror_stealth/           # Base de Survival Horror con sigilo, linterna y patrulla enemiga
    └── arcade_arena/             # Base de Arena Arcade contrarreloj con puntuación
```

---

## 3. Manual de uso de HK Engine 1 Studio

### 3.1 Crear un proyecto nuevo
1. Elegí en el selector superior una de las 3 plantillas (`fps_exploration`, `horror_stealth` o `arcade_arena`).
2. Al abrir Studio, elegí el perfil **PC** o **PlayStation 2**. Podés volver a cambiarlo desde **Perfil** en cualquier momento.
3. Hacé clic en **+ Nuevo Proyecto** e ingresá el nombre de tu juego. El editor clonará la plantilla dentro de `projects/<tu_juego>/` y guardará el perfil elegido en `project.json`.

### 3.2 Editor de Mapas 2D
- Seleccioná un pincel de **tile** (`Libre`, `Muro A`, `Muro B`, `Muro C`, `Salida`, `Puerta/Reja`) y pintá con clic o arrastrando sobre la grilla.
- Seleccioná un pincel de **entidad** (`Spawn`, `Item`, `Interruptor`, `NPC`, `Enemigo`) y hacé clic sobre cualquier celda libre (`0`) para ubicarla.
- El indicador superior derecho muestra el presupuesto aproximado de triángulos al elegir PS2; para PC indica el perfil WebGL activo.
- Desde el **Inspector** (panel derecho) podés ajustar el nombre del mapa, el color atmosférico (`R/G/B`), la intensidad de luz y las propiedades de cualquier entidad seleccionada.

### 3.3 Editor de Scripts y API del Motor
Cada proyecto define su lógica en `scripts/game.js` registrando *hooks* sobre `HKEngine`:

```js
HKEngine.registerHooks({
    onInit: function (engine, scene) {
        engine.notify("Nivel listo!", 150);
    },
    onUpdate: function (engine, scene, dtMs, dtScale) {
        // Lógica por cuadro normalizada con dtScale (paridad NTSC 60Hz / PAL 50Hz / PC)
    },
    onInteract: function (engine, scene, entity) {
        // Se dispara al pulsar X (PS2) o E/Enter (PC) cerca de una entidad
        if (entity.kind === "item") {
            entity.taken = true;
            scene.player.items++;
            engine.notify("Recogiste " + entity.label, 120);
        }
    },
    onDrawHUD: function (engine, scene, w, h) {
        // Dibujado 2D adicional usando HKPlatform.rect / HKPlatform.text
    }
});
```

#### Referencia rápida de la API
- `HKEngine.loadMap(mapId)` — cambia de nivel/escena dinámicamente.
- `HKEngine.notify(texto, frames)` — muestra un mensaje en la barra inferior del HUD.
- `HKPhysics.isWalkable(grid, x, y, margin)` — valida colisión AABB contra la grilla.
- `HKPhysics.hasLineOfSight(grid, x0, y0, x1, y1)` — comprueba línea de visión directa.
- `HKPlatform.rect(x, y, w, h, rgba(r,g,b,a))` / `HKPlatform.text(x, y, str, scale, col)` — primitivas 2D portables (recordá que el alfa en PS2 GS va de `0` a `128`).
- `HKPlatform.saveJSON(slot, obj)` / `HKPlatform.loadJSON(slot)` — persistencia unificada (`mc0:/HKENGINE/` en PS2, `localStorage` en PC).

### Modelos 3D para PC
- **Importar modelo** acepta archivos Wavefront `.obj`, `.mtl` y texturas `.png` / `.jpg`. Seleccioná el OBJ junto con su MTL y las texturas referenciadas por `map_Kd`.
- Los recursos quedan en `assets/models/`. En el inspector de una entidad, completá **Modelo 3D (ruta OBJ)**, por ejemplo `assets/models/mi_modelo.obj`.
- El exportador PC incluye los recursos y ejecuta la escena con WebGL, profundidad, iluminación direccional, niebla y materiales texturizados. Si una entidad no tiene un OBJ asignado, se representa con una malla simple según su tipo.
- Los proyectos PS2 conservan AthenaEnv/VU1 y reciben las texturas base de Subsuelo04 para piso, techo, concreto, óxido, ritual, salida y rejas. Podés reemplazarlas en tu proyecto con archivos del mismo nombre bajo `assets/textures/`.

### 3.5 Abrir proyectos modulares PS2 existentes (modo dual)
**HK Engine 1 Studio** también puede abrir cualquier proyecto modular externo de PlayStation 2 (`src/*.js` + `src/map.js` + `tools/build_main.py` / `tools/generate_map_walls.py`) sin mover archivos:
- Hacé clic en **Abrir Carpeta** en la barra superior (o iniciá con `python3 hk_studio.py --open /ruta/a/tu/proyecto`).
- El **Editor de Mapas 2D** detecta automáticamente las grillas (`const *_MAP = [...]`) de `src/map.js` y te permite editarlas y recorrerlas en la **Vista Previa 3D**.
- El **Editor de Scripts** lista y guarda directamente todos los módulos de `src/*.js`.
- El botón **Exportar PS2** ejecuta `tools/generate_map_walls.py` y `tools/build_main.py` del proyecto para regenerar tus `.obj` y el `main.js` listo para consola.

### 3.4 Probar en vivo
Presioná **Probar en Vivo** (o la pestaña **Vista Previa 3D**) para recorrer tu mapa inmediatamente con **WASD**, **Flechas**, **C** (agacharse/sigilo) y **F** (luz).

---

## 4. Exportar a PlayStation 2 y PC (`.exe`)

### 4.1 Exportar para PlayStation 2 (OPL USB / DVD-R / PCSX2)
Desde el botón **Exportar PS2** del editor o por consola:

```bash
python3 tools/build_ps2.py projects/mi_juego
```

El exportador genera `dist/ps2/mi_juego/` con:
- `main.js` — bundle monolítico sin `import` ES6 (100% compatible con `mass:/`, `cdfs:/` y `host:/`).
- `assets/models/<mapa>_*.obj` — mallas 3D trianguladas con fusión colineal de quads y *culling* de caras internas para evitar *Z-fighting* en el GS de PS2.
- `athena.ini` (CRLF), `SYSTEM.CNF` (CRLF) y `title.cfg` (OPL APPS).

Para correrlo en **PS2 real** o **PCSX2**, solo copiá tu binario `athena.elf` (AthenaEnv V4) dentro de esa carpeta y copiala a `mass:/APPS/MiJuego/` en un pendrive FAT32 (con PADEMU desactivado en OPL).

### 4.2 Exportar para PC (Desktop y `.exe`)
Desde el botón **Exportar PC (.exe)** del editor o por consola:

```bash
python3 tools/build_pc.py projects/mi_juego
```

El exportador genera `dist/pc/mi_juego/` con:
- `index.html` + `game_bundle.js` — versión WebGL jugable en cualquier navegador o ventana local.
- `assets/` — modelos OBJ/MTL y texturas del proyecto más los materiales base del perfil.
- `launcher_pc.py` — lanzador de escritorio (usa `pywebview` si está instalado o abre el navegador local).
- `build_exe.bat` — script listo para Windows que empaqueta todo en un único ejecutable independiente `mi_juego.exe` con **PyInstaller** (`--onefile --noconsole`).

---

## 5. Buenas prácticas de rendimiento (PS2 Real)

1. Evitá crear objetos `{}` o arrays `[]` dentro de `onUpdate` / `onDrawHUD` para no disparar el Garbage Collector de QuickJS en MIPS.
2. Usá siempre `dtScale` en desplazamientos y temporizadores para mantener velocidad idéntica entre NTSC 60 Hz, PAL 50 Hz y PC.
3. Mantené cada mapa debajo de ~1.500–1.800 triángulos y las texturas 3D en `64×64` PNG RGB para respetar los 4 MB de GS VRAM.

---

## Créditos

- **Motor y Editor**: HK Engine 1 — **HK Entertainment** (Joaquín Gasperetti)
- **Runtime PlayStation 2**: [AthenaEnv V4](https://github.com/DanielSant0s/AthenaEnv) (Daniel Santos)
