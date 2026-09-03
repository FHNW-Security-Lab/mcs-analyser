#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-${ROOT_DIR}/.venv/bin/python}"
OUTPUT_DIR="${ROOT_DIR}/web/public/analysis"

if [[ ! -x "${PYTHON}" ]]; then
  echo "angr virtual environment not found at ${PYTHON}" >&2
  echo "Create .venv and install requirements.txt, or set PYTHON explicitly." >&2
  exit 1
fi

mkdir -p "${OUTPUT_DIR}"
make -C "${ROOT_DIR}/bin/aviation" clean all

run_analysis() {
  local profile="$1"
  local output="${OUTPUT_DIR}/aviation-${profile}.json"
  local started=$SECONDS

  echo "Running real angr analysis for ${profile} aircraft..."
  (
    cd "${ROOT_DIR}"
    "${PYTHON}" main.py \
      --config "config_aviation_${profile}.json" \
      --no-visualize \
      --silent \
      --export-json "${output}"
  )
  echo "Completed ${profile} analysis in $((SECONDS - started))s: ${output}"
}

run_analysis secure
run_analysis vulnerable

"${PYTHON}" - "${OUTPUT_DIR}/aviation-secure.json" \
  "${OUTPUT_DIR}/aviation-vulnerable.json" <<'PY'
import json
from pathlib import Path
import sys

expected = {
    "secure": {"attitude_envelope": "satisfied", "route_monitor": "satisfied"},
    "vulnerable": {"attitude_envelope": "violated", "route_monitor": "violated"},
}

for argument in sys.argv[1:]:
    path = Path(argument)
    with path.open("r", encoding="utf-8") as handle:
        artifact = json.load(handle)
    profile = artifact["profile"]
    assert artifact["format"] == "mcs-analyser.analysis"
    assert artifact["analysis"]["status"] == "completed"
    assert artifact["analysis"]["completed_real_angr_run"] is True
    assert artifact["summary"]["incomplete_component_ids"] == []
    assert artifact["generator"]["angr_version"]
    assert artifact["provenance"]["binary_sha256"]
    fusion = next(node for node in artifact["nodes"] if node["id"] == "navigation_fusion")
    if profile == "secure":
        consumed_names = {item["name"] for item in fusion["consumes"]}
        assert consumed_names == {
            "MSG_AFDX_VL_GNSS_POSITION",
            "MSG_AFDX_VL_INS_POSITION",
            "MSG_AFDX_VL_RADIO_POSITION",
        }, consumed_names
        assert fusion["analysis"]["max_hook_inputs"] == 6
        assert any(
            message["producer_component_id"] == "navigation_fusion"
            and message["type"]["name"] == "MSG_AFDX_VL_NAV_SOLUTION"
            and not message["from_unconstrained_run"]
            for message in artifact["messages"]
        )
        assert any(
            message["producer_component_id"] == "aircraft_effect"
            and message["type"]["name"] == "MSG_AFDX_VL_AIRCRAFT_POSITION_STATE"
            and not message["from_unconstrained_run"]
            for message in artifact["messages"]
        )
    findings = {item["id"]: item["status"] for item in artifact["safety_findings"]}
    assert findings == expected[profile], (profile, findings)
    print(
        f"Verified {profile}: {artifact['summary']['component_count']} native components, "
        f"{artifact['summary']['reachable_message_count']} reachable messages, "
        f"{artifact['summary']['constraint_record_count']} constraint records"
    )
PY

sha256sum "${OUTPUT_DIR}/aviation-secure.json" \
  "${OUTPUT_DIR}/aviation-vulnerable.json"
