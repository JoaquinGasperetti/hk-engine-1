#!/usr/bin/env python3
"""Exportador PlayStation 2 (AthenaEnv V4) para HK Engine 1.
Genera dist/ps2/<proyecto>/ listo para OPL APPS (USB FAT32) o DVD-R ISO."""

from __future__ import annotations
import json
import sys
from pathlib import Path
from generate_meshes import compile_map_json

ENGINE_ROOT = Path(__file__).resolve().parent.parent
PS2_CORE_FILES = [
    "engine/core/math.js",
    "engine/core/platform_ps2.js",
    "engine/core/physics.js",
    "engine/core/renderer3d.js",
    "engine/core/scene.js",
]


def export_ps2(project_dir: Path, out_dir: Path) -> Path:
    proj = json.loads((project_dir / "project.json").read_text(encoding="utf-8"))
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. Compilar mallas .obj de todos los mapas del proyecto
    maps_dict = {}
    total_tris = 0
    for mp in sorted((project_dir / "maps").glob("*.json")):
        maps_dict[mp.stem] = json.loads(mp.read_text(encoding="utf-8"))
        total_tris += compile_map_json(mp, out_dir / "assets/models")

    # 2. Ensamblar bundle monolítico main.js (cero imports ES6 para mass:/ y cdfs:/)
    parts = [f"// Built with HK Engine 1 PS2 Exporter — {proj.get('name', 'Game')}\n"]
    for rel in PS2_CORE_FILES:
        parts.append(f"\n// --- ENGINE: {rel} ---\n")
        parts.append((ENGINE_ROOT / rel).read_text(encoding="utf-8"))

    for sp in sorted((project_dir / "scripts").glob("*.js")):
        parts.append(f"\n// --- SCRIPT: {sp.name} ---\n")
        parts.append(sp.read_text(encoding="utf-8"))

    parts.append("\n// --- BOOT ---\n")
    parts.append(f"const HK_PROJECT = {json.dumps(proj, ensure_ascii=False)};\n")
    parts.append(f"const HK_MAPS = {json.dumps(maps_dict, ensure_ascii=False)};\n")
    parts.append("HKEngine.start(HK_PROJECT, HK_MAPS);\n")

    main_js = out_dir / "main.js"
    main_js.write_text("".join(parts), encoding="utf-8", newline="\n")

    # 3. Archivos de configuración PS2 (CRLF obligatorio para athena.ini y SYSTEM.CNF)
    (out_dir / "athena.ini").write_text(
        'boot_logo = false\r\ndark_mode = true\r\ndefault_script = "main.js"\r\n',
        encoding="ascii",
    )
    (out_dir / "SYSTEM.CNF").write_text(
        "BOOT2 = cdrom0:\\ATHA_000.01;1\r\nVER = 1.00\r\nVMODE = NTSC\r\n",
        encoding="ascii",
    )
    (out_dir / "title.cfg").write_text(
        f"title={proj.get('name', 'HK Game')}\nboot=athena.elf\n",
        encoding="utf-8",
    )
    print(f"[PS2 EXPORT OK] {out_dir} ({len(maps_dict)} mapas, {total_tris} tris totales)")
    print("  Nota: copia tu binario athena.elf (AthenaEnv V4) dentro de esta carpeta para ejecutar en PS2/PCSX2.")
    return out_dir


if __name__ == "__main__":
    proj_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else (ENGINE_ROOT / "templates/fps_exploration")
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else (ENGINE_ROOT / "dist/ps2" / proj_dir.name)
    export_ps2(proj_dir.resolve(), out.resolve())
