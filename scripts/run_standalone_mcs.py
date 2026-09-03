#!/usr/bin/env python3
"""Launch the real MCS Analyzer and Schnauzer as one standalone program."""

from __future__ import annotations

import argparse
import logging
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

PROFILE_CONFIGS = {
    "secure": PROJECT_ROOT / "config_aviation_secure.json",
    "vulnerable": PROJECT_ROOT / "config_aviation_vulnerable.json",
}


def _available(host: str, port: int) -> bool:
    """Return whether a local TCP port can be bound by the standalone app."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind((host, port))
        except OSError:
            return False
    return True


def _wait_for_web(url: str, process: subprocess.Popen, timeout: float = 15.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Schnauzer stopped with exit code {process.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=0.5) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError):
            time.sleep(0.15)
    raise TimeoutError(f"Schnauzer did not become ready at {url}")


def _stop(process: subprocess.Popen | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=4)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=2)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Standalone ALBATROS aircraft MCS Analyzer + Schnauzer",
    )
    parser.add_argument("--profile", choices=sorted(PROFILE_CONFIGS), default="secure")
    parser.add_argument("--config", type=Path, help="Analyze another compatible MCS configuration")
    parser.add_argument("--web-port", type=int, default=8080, help="Standalone UI port")
    parser.add_argument("--backend-port", type=int, default=8086, help="Schnauzer graph-ingest port")
    parser.add_argument("--export-json", type=Path, help="Full analysis artifact output path")
    parser.add_argument("--no-browser", action="store_true", help="Do not open the standalone UI automatically")
    parser.add_argument("--debug", action="store_true", help="Show verbose angr and analyzer diagnostics")
    parser.add_argument("--exit-after-analysis", action="store_true", help=argparse.SUPPRESS)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    config_path = (args.config or PROFILE_CONFIGS[args.profile]).expanduser().resolve()
    export_path = (args.export_json or PROJECT_ROOT / "standalone_output" / f"aviation-{args.profile}.json").expanduser().resolve()

    if not config_path.is_file():
        raise SystemExit(f"Configuration not found: {config_path}")
    if args.web_port == args.backend_port:
        raise SystemExit("The web and backend ports must be different")
    for port in (args.web_port, args.backend_port):
        if not 1 <= port <= 65535:
            raise SystemExit(f"Invalid port: {port}")
        if not _available("127.0.0.1", port):
            raise SystemExit(f"Port {port} is already in use")

    export_path.parent.mkdir(parents=True, exist_ok=True)
    url = f"http://127.0.0.1:{args.web_port}/"
    server_process: subprocess.Popen | None = None

    try:
        print(f"Starting standalone Schnauzer at {url}", flush=True)
        schnauzer_entrypoint = Path(sys.executable).with_name("schnauzer-server")
        server_command = [str(schnauzer_entrypoint)] if schnauzer_entrypoint.is_file() else [sys.executable, "-m", "schnauzer.server"]
        server_process = subprocess.Popen(
            [
                *server_command,
                "--port",
                str(args.web_port),
                "--backend-port",
                str(args.backend_port),
            ],
            cwd=PROJECT_ROOT,
        )
        _wait_for_web(f"{url}graph-data", server_process)

        if not args.no_browser:
            webbrowser.open(url)

        # Import only after the Schnauzer process is healthy so startup errors
        # remain fast and do not initialize angr unnecessarily.
        from analyser.common.logger import set_dependency_log_level, set_project_log_level

        set_project_log_level(logging.DEBUG if args.debug else logging.INFO)
        set_dependency_log_level(logging.DEBUG if args.debug else logging.ERROR)

        from analyser import Coordinator
        from analyser.common.mcs_graph import MCSGraph
        from schnauzer import VisualizationClient

        graph = MCSGraph.get_instance()
        graph.vc.disconnect()
        graph.vc = VisualizationClient(host="127.0.0.1", port=args.backend_port)

        print(f"Running real angr MCS analysis: {config_path.name}", flush=True)
        Coordinator.run(
            config_path=config_path,
            step_mode=False,
            visualize=True,
            export_path=export_path,
        )
        print(f"Standalone graph ready: {url}", flush=True)
        print(f"Analysis artifact: {export_path}", flush=True)

        if args.exit_after_analysis:
            return 0
        print("Press Ctrl+C to close the standalone analyzer.", flush=True)
        return server_process.wait()
    except KeyboardInterrupt:
        return 0
    finally:
        _stop(server_process)


if __name__ == "__main__":
    raise SystemExit(main())
