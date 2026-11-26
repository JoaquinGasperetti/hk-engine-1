#!/usr/bin/env python3
"""Exportador PC (App Desktop + generador de .exe vía PyInstaller) para HK Engine 1."""

from __future__ import annotations
import json
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


def export_pc(project_dir: Path, out_dir: Path) -> Path:
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

    # Launcher Python (abre ventana nativa con pywebview si está instalado, o navegador local)
    (out_dir / "launcher_pc.py").write_text(
        """import http.server, socketserver, sys, threading, webbrowser
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
    url = f"http://127.0.0.1:{port}/index.html"
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        import webview
        webview.create_window("HK Engine 1", url, width=1024, height=720)
        webview.start()
    except ImportError:
        webbrowser.open(url)
        input("Juego abierto en el navegador. Presiona ENTER para cerrar...")

if __name__ == "__main__":
    main()
""",
        encoding="utf-8",
    )

    slug = proj_dir.name
    bat_lines = [
        "@echo off",
        f"echo Compilando {slug}.exe con PyInstaller...",
        "pip install pyinstaller pywebview",
        f'pyinstaller --onefile --noconsole --name {slug} --add-data "index.html;." --add-data "game_bundle.js;." launcher_pc.py',
        f"echo Listo! Ejecutable generado en dist\\{slug}.exe",
        "pause",
        "",
    ]
    (out_dir / "build_exe.bat").write_text("\r\n".join(bat_lines), encoding="ascii")

    print(f"[PC EXPORT OK] {out_dir}")
    print("  - Probar directo: python3 launcher_pc.py (o abrir index.html)")
    print("  - Generar .exe en Windows: ejecutar build_exe.bat")
    return out_dir


if __name__ == "__main__":
    proj_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else (ENGINE_ROOT / "templates/fps_exploration")
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else (ENGINE_ROOT / "dist/pc" / proj_dir.name)
    export_pc(proj_dir.resolve(), out.resolve())
