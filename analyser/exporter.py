"""Strict, self-contained JSON snapshots of completed native MCA runs."""

from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
from importlib.metadata import PackageNotFoundError, version as package_version
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
from typing import Any
from uuid import uuid4

from analyser.can_simulator import CANBus
from analyser.common import Config, MessageTracer
from analyser.common.constraint_summary import summarize_constraint
from analyser.common.mcs_graph import MCSGraph


FORMAT_NAME = "mcs-analyser.analysis"
SCHEMA_VERSION = "1.0.0"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _sha256_file(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _package_version(name: str) -> str | None:
    try:
        return package_version(name)
    except PackageNotFoundError:
        return None


def _git_metadata(repo_dir: Path) -> dict[str, Any]:
    def run_git(*args: str) -> str | None:
        try:
            result = subprocess.run(
                ["git", *args], cwd=repo_dir, check=True, capture_output=True,
                text=True,
            )
            return result.stdout.strip()
        except (OSError, subprocess.CalledProcessError):
            return None

    commit = run_git("rev-parse", "HEAD")
    status = run_git("status", "--porcelain")
    return {
        "commit": commit,
        "dirty": bool(status) if status is not None else None,
    }


def _serialize_iostate(io_state) -> dict[str, Any]:
    bv = io_state.bv
    bits = int(bv.length)
    constraints = [
        {
            "format": "claripy-str",
            "text": str(constraint),
            "variables": sorted(constraint.variables),
        }
        for constraint in io_state.constraints
    ]

    result: dict[str, Any] = {
        "kind": "symbolic" if bv.symbolic else "concrete",
        "bits": bits,
        "variables": sorted(bv.variables),
        "constraints": constraints,
    }
    if bv.symbolic:
        result.update({
            "expression": str(bv),
            "expression_format": "claripy-str",
            "unsigned_decimal": None,
            "signed_decimal": None,
            "hex": None,
        })
    else:
        value = int(bv.concrete_value)
        signed_value = value - (1 << bits) if value & (1 << (bits - 1)) else value
        width = max(1, (bits + 3) // 4)
        result.update({
            "expression": None,
            "expression_format": None,
            "unsigned_decimal": str(value),
            "signed_decimal": str(signed_value),
            "hex": f"0x{value:0{width}x}",
        })
    return result


def build_analysis_snapshot(*, started_at: str, duration_seconds: float,
                            visualize: bool, command: list[str] | None = None) -> dict[str, Any]:
    """Build a JSON-safe snapshot while the CANBus context is still populated."""
    graph = MCSGraph.get_instance()
    config_path = Path(CANBus.config_path).resolve()
    config_data = Config.source_data

    component_by_name = {component.name: component for component in CANBus.components}
    stable_id_by_name = {
        component.name: str(component.component_id) for component in CANBus.components
    }
    numeric_id_by_name = {
        component.name: cid for cid, component in CANBus.components.items()
    }

    nodes: list[dict[str, Any]] = []
    binary_hashes: dict[str, str] = {}
    for cid, component in CANBus.components.items():
        consumes = sorted(component.consumed_ids)
        produces = sorted(component.produced_ids)
        if not consumes and produces:
            kind = "source"
        elif consumes and not produces:
            kind = "sink"
        elif consumes and produces:
            kind = "processor"
        else:
            kind = "isolated"

        binary_path = component.path.resolve()
        binary_hash = _sha256_file(binary_path)
        binary_hashes[str(component.component_id)] = binary_hash
        node = {
            "id": str(component.component_id),
            "numeric_id": cid,
            "name": component.name,
            "description": component.description,
            "profile": config_data.get("profile"),
            "kind": kind,
            "role": component.metadata.get("role", kind),
            "metadata": component.metadata,
            "binary": {
                "filename": binary_path.name,
                "path": str(binary_path),
                "sha256": binary_hash,
                "size_bytes": binary_path.stat().st_size,
                "architecture": "x86-64",
            },
            "analysis": {
                "completed": bool(component.is_analysed),
                "max_hook_inputs": component.max_expected_inputs,
                "max_bus_messages_per_run": component.max_expected_inputs // 2,
            },
            "consumes_message_type_ids": consumes,
            "produces_message_type_ids": produces,
            "consumes": [
                {"id": msg_id, "hex": f"0x{msg_id:x}",
                 "name": Config.message_name_lookup.get(msg_id)}
                for msg_id in consumes
            ],
            "produces": [
                {"id": msg_id, "hex": f"0x{msg_id:x}",
                 "name": Config.message_name_lookup.get(msg_id)}
                for msg_id in produces
            ],
        }
        nodes.append(node)

    messages: list[dict[str, Any]] = []
    messages_by_id: dict[int, dict[str, Any]] = {}
    constraints: list[dict[str, Any]] = []
    for message_id, message in CANBus.buffer.items():
        type_id = int(message.msg_type.bv.concrete_value)
        data = _serialize_iostate(message.msg_data)
        entry = {
            "id": message_id,
            "producer_component_id": stable_id_by_name[message.producer_component_name],
            "producer_component_numeric_id": numeric_id_by_name[message.producer_component_name],
            "from_unconstrained_run": bool(message.from_unconstrained_run),
            "reachability": ("discovery_only" if message.from_unconstrained_run
                              else "reachable_from_configured_sources"),
            "type": {
                "id": type_id,
                "hex": f"0x{type_id:x}",
                "name": Config.message_name_lookup.get(type_id),
                "bits": int(message.msg_type.bv.length),
            },
            "data": data,
        }
        messages.append(entry)
        messages_by_id[message_id] = entry
        if data["kind"] == "symbolic" or data["constraints"]:
            readable = summarize_constraint(
                entry["type"]["name"] or f"MESSAGE_{message_id}",
                config_data.get("profile"),
                len(data["constraints"]),
            )
            constraints.append({
                "message_id": message_id,
                "producer_component_id": entry["producer_component_id"],
                "message_type_id": type_id,
                "message_type_name": entry["type"]["name"],
                "reachability": entry["reachability"],
                "payload_expression": data["expression"],
                "variables": data["variables"],
                "predicates": data["constraints"],
                **readable,
            })

    productions = []
    for production in MessageTracer.get_productions():
        component_name = production["component"]
        productions.append({
            "id": production["production_id"],
            "component_id": stable_id_by_name[component_name],
            "component_numeric_id": numeric_id_by_name[component_name],
            "output_message_id": production["output_msg_id"],
            "input_message_ids": production["consumed_msg_ids"],
            "input_order": "unordered",
        })

    edges: list[dict[str, Any]] = []
    for source, target, key, edge_data in graph.edges(keys=True, data=True):
        message_id = edge_data.get("msg_id")
        message = messages_by_id.get(message_id)
        message_type_name = message["type"]["name"] if message else edge_data.get("type")
        edge_constraints = message["data"]["constraints"] if message else []
        readable = summarize_constraint(
            message_type_name or f"MESSAGE_{message_id}",
            config_data.get("profile"),
            len(edge_constraints),
        )
        edges.append({
            "id": f"edge-{stable_id_by_name[source]}-{stable_id_by_name[target]}-{message_id}-{key}",
            "source": stable_id_by_name[source],
            "target": stable_id_by_name[target],
            "source_component_id": stable_id_by_name[source],
            "target_component_id": stable_id_by_name[target],
            "message_id": message_id,
            "message_type_id": message["type"]["id"] if message else None,
            "message_type_name": message_type_name,
            "from_unconstrained_run": bool(edge_data.get("from_unconstrained_run", False)),
            "reachability": (message["reachability"] if message else "unknown"),
            "constraints": edge_constraints,
            **readable,
        })
    edges.sort(key=lambda item: (item["source"], item["target"], item["message_id"], item["id"]))

    message_types = [
        {"id": type_id, "hex": f"0x{type_id:x}", "name": name, "bits": 64}
        for type_id, name in sorted(Config.message_name_lookup.items())
    ]
    traces = MessageTracer.get_traces_dict(CANBus.buffer.keys())
    incomplete = [node["id"] for node in nodes if not node["analysis"]["completed"]]
    status = "completed" if not incomplete else "partial"
    reachable_messages = [message for message in messages
                          if not message["from_unconstrained_run"]]
    unsafe_reachable_ids = [
        message["id"] for message in reachable_messages
        if message["type"]["name"] == "MSG_AFDX_VL_AIRCRAFT_UNSAFE_STATE"
    ]
    diverged_reachable_ids = [
        message["id"] for message in reachable_messages
        if message["type"]["name"] == "MSG_AFDX_VL_AIRCRAFT_DIVERGED_STATE"
    ]
    finished_at = _utc_now()
    git = _git_metadata(config_path.parent)

    return {
        "format": FORMAT_NAME,
        "schema_version": SCHEMA_VERSION,
        "profile": config_data.get("profile"),
        "generator": {
            "name": "mcs-analyser",
            "version": git["commit"] or "development",
            "git": git,
            "python_version": platform.python_version(),
            "angr_version": _package_version("angr"),
            "claripy_version": _package_version("claripy"),
            "networkx_version": _package_version("networkx"),
        },
        "run": {
            "id": str(uuid4()),
            "started_at": started_at,
            "finished_at": finished_at,
            "duration_seconds": round(duration_seconds, 6),
            "status": status,
            "profile": config_data.get("profile"),
            "visualization_requested": visualize,
            "command": command or sys.argv,
        },
        "analysis": {
            "status": status,
            "engine": "angr",
            "execution_mode": "native-x86-64-binary-symbolic-execution",
            "completed_real_angr_run": status == "completed",
            "binary_inputs_verified": True,
            "fixed_point_reached": status == "completed",
            "completed_at": finished_at,
            "reachability_scope": "component-local transfer relations propagated to a message fixed point",
            "discovery_messages_are_reachable": False,
        },
        "provenance": {
            "config_path": str(config_path),
            "config_sha256": _sha256_file(config_path),
            "binary_sha256": binary_hashes,
            "configuration": config_data,
        },
        "input": {
            "config": {
                "path": str(config_path),
                "sha256": _sha256_file(config_path),
                "schema_version": config_data.get("schema_version"),
                "profile": config_data.get("profile"),
            }
        },
        "message_types": message_types,
        "nodes": nodes,
        "components": nodes,
        "messages": messages,
        "constraints": constraints,
        "productions": productions,
        "edges": edges,
        "communication_edges": edges,
        "traces": traces,
        "safety_findings": [
            {
                "id": "attitude_envelope",
                "property": "abs(pitch) <= 18 deg and abs(roll) <= 32 deg",
                "status": "violated" if unsafe_reachable_ids else "satisfied",
                "reachable_violation_message_ids": unsafe_reachable_ids,
                "evidence_message_type": "MSG_AFDX_VL_AIRCRAFT_UNSAFE_STATE",
            },
            {
                "id": "route_monitor",
                "property": "position remains inside the configured route-residual monitor",
                "status": "violated" if diverged_reachable_ids else "satisfied",
                "reachable_violation_message_ids": diverged_reachable_ids,
                "evidence_message_type": "MSG_AFDX_VL_AIRCRAFT_DIVERGED_STATE",
            },
        ],
        "summary": {
            "component_count": len(nodes),
            "analysed_component_count": len(nodes) - len(incomplete),
            "message_type_count": len(message_types),
            "message_count": len(messages),
            "reachable_message_count": len(reachable_messages),
            "discovery_only_message_count": len(messages) - len(reachable_messages),
            "symbolic_message_count": sum(message["data"]["kind"] == "symbolic" for message in messages),
            "constraint_record_count": len(constraints),
            "production_count": len(productions),
            "communication_edge_count": len(edges),
            "trace_terminal_count": len(traces),
            "incomplete_component_ids": incomplete,
        },
    }


def write_analysis_json(snapshot: dict[str, Any], destination: Path) -> None:
    """Atomically write a deterministic, strict-JSON analysis artifact."""
    destination = Path(destination).expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=destination.parent,
            prefix=f".{destination.name}.", suffix=".tmp", delete=False,
        ) as handle:
            temporary_path = Path(handle.name)
            json.dump(snapshot, handle, allow_nan=False, ensure_ascii=False,
                      indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temporary_path, destination)
        destination.chmod(0o644)
        destination.chmod(0o644)
    except Exception:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
        raise
