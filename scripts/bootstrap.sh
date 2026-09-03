#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

find_python() {
  local candidate
  for candidate in \
    "${PYTHON_BOOTSTRAP:-}" \
    python3.12
  do
    if [[ -n "${candidate}" ]] && command -v "${candidate}" >/dev/null 2>&1; then
      if "${candidate}" -c 'import sys; raise SystemExit(sys.version_info[:2] != (3, 12))'; then
        command -v "${candidate}"
        return 0
      fi
    fi
  done
  return 1
}

if [[ ! -x .venv/bin/python ]]; then
  if ! BOOTSTRAP_PYTHON="$(find_python)"; then
    echo "Python 3.12 is required to create the angr environment." >&2
    echo "Install Python 3.12 or set PYTHON_BOOTSTRAP=/path/to/python3.12." >&2
    exit 1
  fi
  "${BOOTSTRAP_PYTHON}" -m venv .venv
fi

.venv/bin/python -m pip install -r requirements.txt
npm --prefix web install
make -C bin/aviation all

echo "Setup complete. Run 'make analysis', then 'make web-build serve'."
