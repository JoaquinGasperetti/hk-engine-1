#!/usr/bin/env python3
"""
hk_studio.py — Interfaz visual (IDE) local de HK Engine 1 (sin dependencias externas).
Abre el editor en http://127.0.0.1:8765 con Editor de Mapas, Editor de Scripts,
Inspector, Vista Previa 3D en vivo y Exportadores directos a PS2 y PC (.exe).

Uso:
    python3 hk_studio.py
    python3 hk_studio.py --port 8765 --no-browser
"""

from __future__ import annotations

import argparse
import http.server
import json
import re
import shutil
import socketserver
import subprocess
import sys
import urllib.parse
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EDITOR_DIR = ROOT / "editor"
TEMPLATES_DIR = ROOT / "templates"
PROJECTS_DIR = ROOT / "projects"


def safe_project_dir(rel_path: str) -> Path:
    candidate = (ROOT / rel_path).resolve()
    if ROOT not in candidate.parents:
        raise ValueError("Ruta fuera del directorio del motor")
    if not (candidate / "project.json").is_file():
        raise FileNotFoundError(f"Proyecto invalido: {rel_path}")
    return candidate


def list_all_projects() -> list[dict]:
    items = []
    for base, kind in ((PROJECTS_DIR, "project"), (TEMPLATES_DIR, "template")):
        if not base.exists():
            continue
        for p in sorted(base.iterdir()):
            pj = p / "project.json"
            if p.is_dir() and pj.is_file():
                meta = json.loads(pj.read_text(encoding="utf-8"))
                items.append({
                    "path": p.relative_to(ROOT).as_posix(),
                    "slug": p.name,
                    "kind": kind,
                    "name": meta.get("name", p.name),
                    "genre": meta.get("genre", ""),
                })
    return items


class HKStudioHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(EDITOR_DIR), **kwargs)

    def log_message(self, format, *args):
        pass

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        return json.loads(raw.decode("utf-8"))

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        try:
            if parsed.path == "/api/projects":
                return self._send_json({"projects": list_all_projects()})
            if parsed.path == "/api/project":
                pdir = safe_project_dir(qs["path"][0])
                proj = json.loads((pdir / "project.json").read_text(encoding="utf-8"))
                maps = sorted(f.stem for f in (pdir / "maps").glob("*.json"))
                scripts = sorted(f.name for f in (pdir / "scripts").glob("*.js"))
                return self._send_json({"project": proj, "maps": maps, "scripts": scripts})
            if parsed.path == "/api/map":
                pdir = safe_project_dir(qs["path"][0])
                name = Path(qs["name"][0]).stem
                data = json.loads((pdir / "maps" / f"{name}.json").read_text(encoding="utf-8"))
                return self._send_json({"map": data})
            if parsed.path == "/api/script":
                pdir = safe_project_dir(qs["path"][0])
                name = Path(qs["name"][0]).name
                code = (pdir / "scripts" / name).read_text(encoding="utf-8")
                return self._send_json({"code": code})
        except Exception as exc:
            return self._send_json({"error": str(exc)}, status=400)
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        try:
            payload = self._read_json()
            if parsed.path == "/api/save-project":
                pdir = safe_project_dir(payload["path"])
                (pdir / "project.json").write_text(
                    json.dumps(payload["project"], indent=2, ensure_ascii=False) + "\n",
                    encoding="utf-8",
                )
                return self._send_json({"ok": True})

            if parsed.path == "/api/save-map":
                pdir = safe_project_dir(payload["path"])
                name = re.sub(r"[^a-zA-Z0-9_\-]", "_", payload["name"])
                (pdir / "maps" / f"{name}.json").write_text(
                    json.dumps(payload["map"], indent=2, ensure_ascii=False) + "\n",
                    encoding="utf-8",
                )
                return self._send_json({"ok": True, "name": name})

            if parsed.path == "/api/save-script":
                pdir = safe_project_dir(payload["path"])
                name = Path(payload["name"]).name
                (pdir / "scripts" / name).write_text(payload["code"], encoding="utf-8")
                return self._send_json({"ok": True})

            if parsed.path == "/api/new-project":
                tpl = safe_project_dir(payload.get("template", "templates/fps_exploration"))
                slug = re.sub(r"[^a-z0-9_\-]", "_", payload.get("slug", "mi_juego").lower()).strip("_") or "mi_juego"
                dest = PROJECTS_DIR / slug
                if dest.exists():
                    return self._send_json({"error": f"Ya existe projects/{slug}"}, status=400)
                PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
                shutil.copytree(tpl, dest)
                pj = dest / "project.json"
                meta = json.loads(pj.read_text(encoding="utf-8"))
                meta["name"] = payload.get("name") or slug
                pj.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                return self._send_json({"ok": True, "path": f"projects/{slug}"})

            if parsed.path in ("/api/export-ps2", "/api/export-pc"):
                pdir = safe_project_dir(payload["path"])
                tool = "tools/build_ps2.py" if parsed.path == "/api/export-ps2" else "tools/build_pc.py"
                proc = subprocess.run(
                    [sys.executable, str(ROOT / tool), str(pdir)],
                    capture_output=True,
                    text=True,
                )
                return self._send_json({
                    "ok": proc.returncode == 0,
                    "stdout": proc.stdout,
                    "stderr": proc.stderr,
                })
        except Exception as exc:
            return self._send_json({"error": str(exc)}, status=400)
        return self._send_json({"error": "Endpoint desconocido"}, status=404)


def main():
    parser = argparse.ArgumentParser(description="HK Engine 1 Studio — Editor visual PS2 + PC")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", args.port), HKStudioHandler) as httpd:
        url = f"http://127.0.0.1:{args.port}/index.html"
        print(f"HK Engine 1 Studio corriendo en {url} (Ctrl+C para salir)")
        if not args.no_browser:
            webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nHK Engine 1 Studio detenido.")


if __name__ == "__main__":
    main()
