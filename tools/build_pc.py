#!/usr/bin/env python3
"""Exportador PC (App Desktop + generador de .exe vía PyInstaller) para HK Engine 1.
Soporta tanto proyectos nativos (project.json) como proyectos modulares PS2 (AthenaEnv V4)."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

ENGINE_ROOT = Path(__file__).resolve().parent.parent
PC_CORE_FILES = [
    "engine/core/math.js",
    "engine/core/platform_pc.js",
    "engine/core/physics.js",
    "engine/core/renderer3d.js",
    "engine/core/scene.js",
]


def write_launcher_and_bat(out_dir: Path, title: str, slug: str, extra_add_data: list[str]) -> None:
    (out_dir / "launcher_pc.py").write_text(
        f"""import http.server, socketserver, sys, threading, webbrowser
from pathlib import Path

BASE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE), **kwargs)
    def log_message(self, *args):
        pass

def main():
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    port = httpd.server_address[1]
    url = f"http://127.0.0.1:{{port}}/index.html"
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        import webview
        webview.create_window({title!r}, url, width=1024, height=720)
        webview.start()
    except ImportError:
        webbrowser.open(url)
        input("Juego abierto en el navegador. Presiona ENTER para cerrar...")

if __name__ == "__main__":
    main()
""",
        encoding="utf-8",
    )

    add_flags = " ".join(f'--add-data "{item}"' for item in extra_add_data)
    bat_lines = [
        "@echo off",
        f"echo Compilando {slug}.exe con PyInstaller...",
        "pip install pyinstaller pywebview",
        f'pyinstaller --onefile --noconsole --name {slug} {add_flags} launcher_pc.py',
        f"echo Listo! Ejecutable generado en dist\\{slug}.exe",
        "pause",
        "",
    ]
    (out_dir / "build_exe.bat").write_text("\r\n".join(bat_lines), encoding="ascii")


def export_modular_ps2_to_pc(project_dir: Path, out_dir: Path) -> Path:
    """Exporta un proyecto modular PS2 (AthenaEnv V4) a PC / .exe usando athena_pc_shim.js."""
    if (project_dir / "tools/build_main.py").is_file():
        subprocess.run([sys.executable, str(project_dir / "tools/build_main.py")], cwd=project_dir, check=True)

    main_src = project_dir / "main.js"
    if not main_src.is_file():
        raise FileNotFoundError(f"No se encontro main.js en {project_dir}")

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Copiar shim de AthenaEnv + main.js + assets (audio, texturas, fuentes)
    shutil.copy2(ENGINE_ROOT / "engine/core/athena_pc_shim.js", out_dir / "athena_pc_shim.js")
    shutil.copy2(main_src, out_dir / "main.js")

    manifest = []
    assets_src = project_dir / "assets"
    if assets_src.is_dir():
        shutil.copytree(assets_src, out_dir / "assets")
        for f in sorted((out_dir / "assets").rglob("*")):
            if f.is_file():
                manifest.append(f.relative_to(out_dir).as_posix())

    (out_dir / "asset_manifest.js").write_text(
        f"window.HK_ASSET_MANIFEST = {json.dumps(manifest, ensure_ascii=False)};\n",
        encoding="utf-8",
    )

    title = project_dir.name
    (out_dir / "index.html").write_text(
        f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>{title} — HK Engine 1 PC</title>
<style>
  html, body {{ margin: 0; height: 100%; background: #040508; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; font-family: system-ui, sans-serif; color: #94a3b8; }}
  canvas {{ width: min(100vw, calc((100vh - 28px) * 640 / 448)); height: auto; image-rendering: pixelated; box-shadow: 0 20px 60px rgba(0,0,0,0.8); border: 1px solid #1e293b; cursor: crosshair; }}
  .bar {{ font-size: 11.5px; margin-top: 6px; opacity: 0.85; }}
</style>
</head>
<body>
<canvas id="hk-canvas" width="640" height="448"></canvas>
<div class="bar">PC Controls: WASD mover · Mouse/Flechas mirar · E/Enter = X · Shift = O · C = Cuad · F = Linterna · G = L2 · Tab = PDA · Esc = Pausa</div>
<script src="asset_manifest.js"></script>
<script src="athena_pc_shim.js"></script>
<script src="main.js"></script>
</body>
</html>
""",
        encoding="utf-8",
    )

    add_data = ["index.html;.", "asset_manifest.js;.", "athena_pc_shim.js;.", "main.js;."]
    if (out_dir / "assets").is_dir():
        add_data.append("assets;assets")
    write_launcher_and_bat(out_dir, title, project_dir.name, add_data)

    print(f"[PC EXPORT OK — MODO ATHENA SHIM] {out_dir} ({len(manifest)} assets incluidos)")
    print("  - Probar ahora: python3 launcher_pc.py (en la carpeta exportada)")
    print("  - Compilar .exe en Windows: ejecutar build_exe.bat")
    return out_dir


def export_pc(project_dir: Path, out_dir: Path) -> Path:
    if not (project_dir / "project.json").is_file():
        return export_modular_ps2_to_pc(project_dir, out_dir)

    proj = json.loads((project_dir / "project.json").read_text(encoding="utf-8"))
    out_dir.mkdir(parents=True, exist_ok=True)

    maps_dict = {}
    for mp in sorted((project_dir / "maps").glob("*.json")):
        maps_dict[mp.stem] = json.loads(mp.read_text(encoding="utf-8"))

    parts = [f"// Built with HK Engine 1 PC Exporter — {proj.get('name', 'Game')}\n"]
    for rel in PC_CORE_FILES:
        parts.append(f"\n// --- ENGINE: {rel} ---\n")
        parts.append((ENGINE_ROOT / rel).read_text(encoding="utf-8"))
    for sp in sorted((project_dir / "scripts").glob("*.js")):
        parts.append(f"\n// --- SCRIPT: {sp.name} ---\n")
        parts.append(sp.read_text(encoding="utf-8"))
    parts.append("\n// --- BOOT ---\n")
    parts.append(f"const HK_PROJECT = {json.dumps(proj, ensure_ascii=False)};\n")
    parts.append(f"const HK_MAPS = {json.dumps(maps_dict, ensure_ascii=False)};\n")
    parts.append("window.addEventListener('DOMContentLoaded', function () { HKEngine.start(HK_PROJECT, HK_MAPS); });\n")

    (out_dir / "game_bundle.js").write_text("".join(parts), encoding="utf-8", newline="\n")

    title = proj.get("name", "HK Engine 1 Game")
    (out_dir / "index.html").write_text(
        f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>
  html, body {{ margin: 0; height: 100%; background: #05060a; display: flex; align-items: center; justify-content: center; overflow: hidden; }}
  canvas {{ width: min(100vw, calc(100vh * 640 / 448)); height: auto; image-rendering: pixelated; box-shadow: 0 20px 60px rgba(0,0,0,0.75); border: 1px solid #1e293b; }}
</style>
</head>
<body>
<canvas id="hk-canvas" width="640" height="448"></canvas>
<script src="game_bundle.js"></script>
</body>
</html>
""",
        encoding="utf-8",
    )

    write_launcher_and_bat(out_dir, title, project_dir.name, ["index.html;.", "game_bundle.js;."])
    print(f"[PC EXPORT OK] {out_dir}")
    print("  - Probar ahora: python3 launcher_pc.py")
    print("  - Compilar .exe en Windows: ejecutar build_exe.bat")
    return out_dir


if __name__ == "__main__":
    proj_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else (ENGINE_ROOT / "templates/fps_exploration")
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else (ENGINE_ROOT / "dist/pc" / proj_dir.name)
    export_pc(proj_dir.resolve(), out.resolve())
