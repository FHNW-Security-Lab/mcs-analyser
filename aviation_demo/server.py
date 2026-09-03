"""Flask API and static server for the ALBATROS aviation demonstrator."""

from __future__ import annotations

import json
import subprocess
import sys
import threading
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request, send_from_directory

from .model import public_config
from .reachability import compute_inverse_reachability, compute_reachability


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_DIST = PROJECT_ROOT / "web" / "dist"
ANALYSIS_DIR = PROJECT_ROOT / "web" / "public" / "analysis"
ANALYSIS_SCRIPT = PROJECT_ROOT / "scripts" / "build_aviation_analysis.sh"

app = Flask(__name__, static_folder=str(WEB_DIST), static_url_path="")
_analysis_lock = threading.Lock()
_analysis_state: dict[str, Any] = {
    "running": False,
    "last_started": None,
    "last_finished": None,
    "last_error": None,
}


@app.after_request
def security_headers(response):
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https://*.tile.openstreetmap.org; connect-src 'self'; "
        "font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    )
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return response


def _artifact_path(profile: str) -> Path:
    if profile not in {"secure", "vulnerable"}:
        raise ValueError("profile must be secure or vulnerable")
    return ANALYSIS_DIR / f"aviation-{profile}.json"


def _artifact_summary(profile: str) -> dict[str, Any]:
    path = _artifact_path(profile)
    if not path.exists():
        return {"profile": profile, "available": False, "path": str(path)}
    stat = path.stat()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return {
            "profile": profile,
            "available": False,
            "path": str(path),
            "error": str(error),
        }
    return {
        "profile": profile,
        "available": True,
        "path": str(path),
        "modified_epoch": stat.st_mtime,
        "bytes": stat.st_size,
        "schema_version": payload.get("schema_version"),
        "status": payload.get("status", payload.get("analysis", {}).get("status")),
        "components": len(payload.get("components", payload.get("nodes", []))),
        "edges": len(payload.get("edges", [])),
        "messages": len(payload.get("messages", [])),
        "provenance": payload.get("provenance", {}),
    }


@lru_cache(maxsize=64)
def _cached_reachability(payload_json: str) -> dict[str, Any]:
    payload = json.loads(payload_json)
    return compute_reachability(
        payload["attack_ids"],
        payload["safety"],
        horizon_seconds=payload["horizon_seconds"],
        step_seconds=payload["step_seconds"],
    )


@app.get("/api/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "service": "albatros-aviation-demonstrator",
            "python": sys.version.split()[0],
            "web_built": (WEB_DIST / "index.html").exists(),
            "analysis": {
                profile: _artifact_summary(profile)
                for profile in ("secure", "vulnerable")
            },
        }
    )


@app.get("/api/config")
def config():
    return jsonify(public_config())


@app.get("/api/analysis/status")
def analysis_status():
    return jsonify(
        {
            **_analysis_state,
            "artifacts": {
                profile: _artifact_summary(profile)
                for profile in ("secure", "vulnerable")
            },
        }
    )


@app.get("/api/analysis/<profile>")
def analysis_result(profile: str):
    try:
        path = _artifact_path(profile)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    if not path.exists():
        return (
            jsonify(
                {
                    "error": "Analysis artifact not found",
                    "hint": "Run scripts/run_aviation_analysis.py from the project venv.",
                }
            ),
            404,
        )
    return jsonify(json.loads(path.read_text(encoding="utf-8")))


@app.get("/analysis/<path:filename>")
def live_analysis_artifact(filename: str):
    """Serve the latest headless export, including after an in-page rerun."""
    if filename not in {"aviation-secure.json", "aviation-vulnerable.json"}:
        return jsonify({"error": "Unknown analysis artifact"}), 404
    path = ANALYSIS_DIR / filename
    if not path.exists():
        return jsonify({"error": "Analysis artifact not found"}), 404
    return send_from_directory(ANALYSIS_DIR, filename)


@app.post("/api/analysis/run")
def run_analysis():
    if not ANALYSIS_SCRIPT.exists():
        return jsonify({"error": f"Missing analysis pipeline: {ANALYSIS_SCRIPT}"}), 503
    if not _analysis_lock.acquire(blocking=False):
        return jsonify({"error": "An MCA analysis is already running", **_analysis_state}), 409
    _analysis_state.update(
        running=True,
        last_started=time.time(),
        last_finished=None,
        last_error=None,
    )
    try:
        completed = subprocess.run(
            ["bash", str(ANALYSIS_SCRIPT)],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=480,
            check=False,
        )
        if completed.returncode:
            error = completed.stderr[-8_000:] or completed.stdout[-8_000:]
            _analysis_state["last_error"] = error
            return (
                jsonify(
                    {
                        "error": "MCA analysis failed",
                        "returncode": completed.returncode,
                        "log": error,
                    }
                ),
                500,
            )
        return jsonify(
            {
                "status": "complete",
                "artifacts": {
                    profile: _artifact_summary(profile)
                    for profile in ("secure", "vulnerable")
                },
                "log": completed.stdout[-8_000:],
            }
        )
    except subprocess.TimeoutExpired as error:
        _analysis_state["last_error"] = "Analysis exceeded 480 seconds"
        return jsonify({"error": _analysis_state["last_error"], "detail": str(error)}), 504
    finally:
        _analysis_state["running"] = False
        _analysis_state["last_finished"] = time.time()
        _analysis_lock.release()


@app.post("/api/reachability")
def reachability():
    payload = request.get_json(silent=True) or {}
    canonical = {
        # An explicitly empty list is a nominal run. Only an omitted field
        # keeps the historical single-spoof API default.
        "attack_ids": payload.get("attack_ids", ["gnss_spoof"]),
        "safety": payload.get("safety") or {},
        "horizon_seconds": int(payload.get("horizon_seconds", 180)),
        "step_seconds": int(payload.get("step_seconds", 6)),
    }
    if canonical["horizon_seconds"] < 30 or canonical["horizon_seconds"] > 600:
        return jsonify({"error": "horizon_seconds must be between 30 and 600"}), 400
    if canonical["step_seconds"] < 2 or canonical["step_seconds"] > 30:
        return jsonify({"error": "step_seconds must be between 2 and 30"}), 400
    if canonical["horizon_seconds"] // canonical["step_seconds"] > 120:
        return jsonify({"error": "At most 120 bounded transition steps are supported"}), 400
    try:
        key = json.dumps(canonical, sort_keys=True, separators=(",", ":"))
        result = _cached_reachability(key)
    except (KeyError, TypeError, ValueError) as error:
        return jsonify({"error": str(error)}), 400
    return jsonify(result)


@app.post("/api/inverse-reachability")
def inverse_reachability():
    payload = request.get_json(silent=True) or {}
    horizon_seconds = int(payload.get("horizon_seconds", 120))
    step_seconds = int(payload.get("step_seconds", 6))
    if horizon_seconds < 30 or horizon_seconds > 240:
        return jsonify({"error": "horizon_seconds must be between 30 and 240"}), 400
    if step_seconds < 3 or step_seconds > 12:
        return jsonify({"error": "step_seconds must be between 3 and 12"}), 400
    if horizon_seconds // step_seconds > 80:
        return jsonify({"error": "At most 80 inverse-query transition steps are supported"}), 400
    attack_ids = payload.get("attack_ids")
    if attack_ids is not None and not isinstance(attack_ids, list):
        return jsonify({"error": "attack_ids must be a list when provided"}), 400
    try:
        result = compute_inverse_reachability(
            payload.get("target") or {},
            attack_ids,
            horizon_seconds=horizon_seconds,
            step_seconds=step_seconds,
        )
    except (KeyError, TypeError, ValueError) as error:
        return jsonify({"error": str(error)}), 400
    return jsonify(result)


@app.get("/")
def index():
    if (WEB_DIST / "index.html").exists():
        return send_from_directory(WEB_DIST, "index.html")
    return (
        "The web bundle has not been built. Run `npm install && npm run build` in web/.",
        503,
    )


@app.get("/<path:path>")
def static_or_spa(path: str):
    requested = WEB_DIST / path
    if requested.is_file():
        return send_from_directory(WEB_DIST, path)
    if (WEB_DIST / "index.html").exists():
        return send_from_directory(WEB_DIST, "index.html")
    return "Web bundle not built", 404


def main() -> None:
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)


if __name__ == "__main__":
    main()
