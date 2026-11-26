#!/usr/bin/env python3
"""
hk_studio.py — Interfaz visual (IDE) local de HK Engine 1 (sin dependencias externas).
Soporta dos tipos de proyectos de forma transparente:
  1. Proyectos nativos HK Engine 1 (project.json + maps/*.json + scripts/*.js)
  2. Proyectos modulares externos de PS2/AthenaEnv (tools/modules.json + src/*.js + src/map.js)

Uso:
    python3 hk_studio.py
    python3 hk_studio.py --open /ruta/a/tu/proyecto
    python3 hk_studio.py --port 8765 --no-browser
"""

from __future__ import annotations

import argparse
import ast
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
WORKSPACES_FILE = ROOT / ".hk_workspaces.json"

MAP_CONST_RE = re.compile(r"const\s+([A-Z0-9_]*MAP)\s*=\s*(\[[\s\S]*?\]);")


def load_external_workspaces() -> list[str]:
    if not WORKSPACES_FILE.is_file():
        return []
    try:
        data = json.loads(WORKSPACES_FILE.read_text(encoding="utf-8"))
        return [p for p in data if isinstance(p, str) and Path(p).is_dir()]
    except Exception:
        return []


def save_external_workspaces(paths: list[str]) -> None:
    unique = []
    for p in paths:
        rp = str(Path(p).resolve())
        if rp not in unique and Path(rp).is_dir():
            unique.append(rp)
    WORKSPACES_FILE.write_text(json.dumps(unique, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def detect_project_mode(pdir: Path) -> str | None:
    if (pdir / "project.json").is_file():
        return "native"
    if (pdir / "src").is_dir() and ((pdir / "tools/modules.json").is_file() or (pdir / "main.js").is_file()):
        return "modular"
    return None


def resolve_project_dir(path_str: str) -> tuple[Path, str]:
    raw = Path(path_str)
    candidate = raw.resolve() if raw.is_absolute() else (ROOT / raw).resolve()
    mode = detect_project_mode(candidate)
    if not mode:
        raise FileNotFoundError(f"Proyecto no reconocido (falta project.json o src/): {path_str}")
    return candidate, mode


def list_all_projects() -> list[dict]:
    items = []
    seen = set()

    for ext in load_external_workspaces():
        p = Path(ext).resolve()
        mode = detect_project_mode(p)
        if not mode or str(p) in seen:
            continue
        seen.add(str(p))
        name = p.name
        genre = "Modular PS2 (src/)" if mode == "modular" else ""
        if mode == "native":
            meta = json.loads((p / "project.json").read_text(encoding="utf-8"))
            name = meta.get("name", p.name)
            genre = meta.get("genre", "")
        items.append({"path": str(p), "slug": p.name, "kind": "external", "mode": mode, "name": name, "genre": genre})

    for base, kind in ((PROJECTS_DIR, "project"), (TEMPLATES_DIR, "template")):
        if not base.exists():
            continue
        for p in sorted(base.iterdir()):
            mode = detect_project_mode(p)
            if p.is_dir() and mode and str(p.resolve()) not in seen:
                seen.add(str(p.resolve()))
                meta = json.loads((p / "project.json").read_text(encoding="utf-8")) if mode == "native" else {}
                items.append({
                    "path": p.relative_to(ROOT).as_posix(),
                    "slug": p.name,
                    "kind": kind,
                    "mode": mode,
                    "name": meta.get("name", p.name),
                    "genre": meta.get("genre", ""),
                })
    return items


def read_modular_maps(pdir: Path) -> dict[str, list[list[int]]]:
    map_file = pdir / "src/map.js"
    if not map_file.is_file():
        return {}
    txt = map_file.read_text(encoding="utf-8")
    found = {}
    for m in MAP_CONST_RE.finditer(txt):
        try:
            grid = ast.literal_eval(m.group(2))
            if isinstance(grid, list) and grid and isinstance(grid[0], list):
                found[m.group(1)] = grid
        except Exception:
            pass
    return found


def write_modular_map(pdir: Path, map_name: str, grid: list[list[int]]) -> None:
    map_file = pdir / "src/map.js"
    txt = map_file.read_text(encoding="utf-8")
    pattern = re.compile(rf"(const\s+{re.escape(map_name)}\s*=\s*)(\[[\s\S]*?\]);")
    m = pattern.search(txt)
    if not m:
        raise ValueError(f"No se encontro la constante {map_name} en src/map.js")
    formatted_rows = ",\n".join("    [" + ",".join(str(int(c)) for c in row) + "]" for row in grid)
    replacement = f"{m.group(1)}[\n{formatted_rows}\n];"
    map_file.write_text(txt[:m.start()] + replacement + txt[m.end():], encoding="utf-8")


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
                pdir, mode = resolve_project_dir(qs["path"][0])
                if mode == "native":
                    proj = json.loads((pdir / "project.json").read_text(encoding="utf-8"))
                    maps = sorted(f.stem for f in (pdir / "maps").glob("*.json"))
                    scripts = sorted(f.name for f in (pdir / "scripts").glob("*.js"))
                    return self._send_json({"mode": "native", "project": proj, "maps": maps, "scripts": scripts})
                # Modo modular externo (src/*.js + tools/modules.json)
                maps = list(read_modular_maps(pdir).keys())
                scripts = sorted(f.name for f in (pdir / "src").glob("*.js"))
                proj = {"name": pdir.name, "genre": "Proyecto Modular PS2 (src/)", "author": "Local Workspace"}
                return self._send_json({"mode": "modular", "project": proj, "maps": maps, "scripts": scripts})

            if parsed.path == "/api/map":
                pdir, mode = resolve_project_dir(qs["path"][0])
                name = qs["name"][0]
                if mode == "native":
                    data = json.loads((pdir / "maps" / f"{Path(name).stem}.json").read_text(encoding="utf-8"))
                    return self._send_json({"map": data})
                grids = read_modular_maps(pdir)
                if name not in grids:
                    raise FileNotFoundError(f"Mapa {name} no encontrado en src/map.js")
                grid = grids[name]
                # Encontrar celda libre inicial para vista previa 3D
                sx, sy = 2.5, 2.5
                for gy, row in enumerate(grid):
                    for gx, v in enumerate(row):
                        if v == 0:
                            sx, sy = gx + 0.5, gy + 0.5
                            break
                    else:
                        continue
                    break
                return self._send_json({
                    "map": {
                        "name": name,
                        "spawn": {"x": sx, "y": sy, "ang": 0.0},
                        "atmosphere": {"clearR": 6, "clearG": 8, "clearB": 12, "lightMul": 1.0},
                        "grid": grid,
                        "entities": [],
                    }
                })

            if parsed.path == "/api/script":
                pdir, mode = resolve_project_dir(qs["path"][0])
                name = Path(qs["name"][0]).name
                folder = "scripts" if mode == "native" else "src"
                code = (pdir / folder / name).read_text(encoding="utf-8")
                return self._send_json({"code": code, "folder": folder})
        except Exception as exc:
            return self._send_json({"error": str(exc)}, status=400)
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        try:
            payload = self._read_json()

            if parsed.path == "/api/open-folder":
                folder = Path(payload.get("folder", "")).expanduser().resolve()
                mode = detect_project_mode(folder)
                if not mode:
                    return self._send_json(
                        {"error": "La carpeta debe contener project.json (nativo) o src/ + main.js (modular PS2)."},
                        status=400,
                    )
                ws = load_external_workspaces()
                ws.insert(0, str(folder))
                save_external_workspaces(ws)
                return self._send_json({"ok": True, "path": str(folder), "mode": mode})

            if parsed.path == "/api/save-project":
                pdir, mode = resolve_project_dir(payload["path"])
                if mode == "native":
                    (pdir / "project.json").write_text(
                        json.dumps(payload["project"], indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8",
                    )
                return self._send_json({"ok": True})

            if parsed.path == "/api/save-map":
                pdir, mode = resolve_project_dir(payload["path"])
                if mode == "native":
                    name = re.sub(r"[^a-zA-Z0-9_\-]", "_", payload["name"])
                    (pdir / "maps" / f"{name}.json").write_text(
                        json.dumps(payload["map"], indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8",
                    )
                    return self._send_json({"ok": True, "name": name})
                write_modular_map(pdir, payload["name"], payload["map"]["grid"])
                return self._send_json({"ok": True, "name": payload["name"]})

            if parsed.path == "/api/save-script":
                pdir, mode = resolve_project_dir(payload["path"])
                name = Path(payload["name"]).name
                folder = "scripts" if mode == "native" else "src"
                (pdir / folder / name).write_text(payload["code"], encoding="utf-8")
                return self._send_json({"ok": True})

            if parsed.path == "/api/new-project":
                tpl, tmode = resolve_project_dir(payload.get("template", "templates/fps_exploration"))
                if tmode != "native":
                    tpl = TEMPLATES_DIR / "fps_exploration"
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
                pdir, mode = resolve_project_dir(payload["path"])
                if mode == "modular":
                    if parsed.path == "/api/export-pc":
                        proc = subprocess.run([sys.executable, str(ROOT / "tools/build_pc.py"), str(pdir)], capture_output=True, text=True)
                        return self._send_json({"ok": proc.returncode == 0, "stdout": proc.stdout, "stderr": proc.stderr})
                    logs = []
                    if (pdir / "tools/generate_map_walls.py").is_file():
                        r_mesh = subprocess.run([sys.executable, str(pdir / "tools/generate_map_walls.py")], cwd=pdir, capture_output=True, text=True)
                        logs.append(r_mesh.stdout + r_mesh.stderr)
                    if (pdir / "tools/build_main.py").is_file():
                        r_build = subprocess.run([sys.executable, str(pdir / "tools/build_main.py")], cwd=pdir, capture_output=True, text=True)
                        logs.append(r_build.stdout + r_build.stderr)
                        return self._send_json({"ok": r_build.returncode == 0, "stdout": "\n".join(logs), "stderr": ""})
                    return self._send_json({"ok": True, "stdout": "\n".join(logs) or "[OK] Proyecto modular guardado.", "stderr": ""})

                tool = "tools/build_ps2.py" if parsed.path == "/api/export-ps2" else "tools/build_pc.py"
                proc = subprocess.run([sys.executable, str(ROOT / tool), str(pdir)], capture_output=True, text=True)
                return self._send_json({"ok": proc.returncode == 0, "stdout": proc.stdout, "stderr": proc.stderr})
        except Exception as exc:
            return self._send_json({"error": str(exc)}, status=400)
        return self._send_json({"error": "Endpoint desconocido"}, status=404)


def main():
    parser = argparse.ArgumentParser(description="HK Engine 1 Studio — Editor visual PS2 + PC")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", dest="open_dir", default="", help="Carpeta externa de proyecto a registrar al abrir")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    if args.open_dir:
        folder = Path(args.open_dir).expanduser().resolve()
        if detect_project_mode(folder):
            ws = load_external_workspaces()
            ws.insert(0, str(folder))
            save_external_workspaces(ws)
            print(f"[WORKSPACE] Proyecto externo registrado: {folder}")

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
