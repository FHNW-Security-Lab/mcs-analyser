"""Schnauzer server with ALBATROS terminal-actor lineage interaction."""

from __future__ import annotations

import argparse
from pathlib import Path

from flask import Response, send_from_directory
from schnauzer.server import Server


STATIC_DIR = Path(__file__).with_name("static")
LINEAGE_SCRIPT = "standalone_actor_lineage.js"


def create_server(web_port: int = 8080, backend_port: int = 8086) -> Server:
    """Create Schnauzer and add the project-owned physical lineage module."""
    server = Server(web_port=web_port, backend_port=backend_port)

    @server.app.get(f"/{LINEAGE_SCRIPT}")
    def actor_lineage_script():
        return send_from_directory(STATIC_DIR, LINEAGE_SCRIPT, mimetype="text/javascript")

    @server.app.after_request
    def install_actor_lineage(response: Response) -> Response:
        if response.mimetype == "text/html" and response.status_code == 200:
            html = response.get_data(as_text=True)
            module_tag = f'<script type="module" src="/{LINEAGE_SCRIPT}"></script>'
            if module_tag not in html:
                response.set_data(html.replace("</body>", f"    {module_tag}\n</body>"))
                response.content_length = len(response.get_data())
        return response

    return server


def main() -> None:
    parser = argparse.ArgumentParser(description="ALBATROS standalone Schnauzer server")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--backend-port", type=int, default=8086)
    args = parser.parse_args()
    create_server(args.port, args.backend_port).start()


if __name__ == "__main__":
    main()
