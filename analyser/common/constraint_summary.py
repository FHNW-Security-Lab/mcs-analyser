"""Readable aviation summaries for raw Claripy message predicates."""

from __future__ import annotations


def _humanize(message_type: str) -> str:
    return message_type.removeprefix("MSG_AFDX_").replace("_", " ").title()


def summarize_constraint(message_type: str, profile: str | None, predicate_count: int) -> dict[str, str | int]:
    """Return a compact formula and plain-language meaning for Schnauzer."""
    common: dict[str, tuple[str, str]] = {
        "MSG_AFDX_VL_GNSS_POSITION": (
            "−90° ≤ latitude ≤ +90° ∧ −180° ≤ longitude ≤ +180°",
            "Valid signed WGS-84 coordinate.",
        ),
        "MSG_AFDX_VL_INS_POSITION": (
            "47°N ≤ latitude ≤ 55°N ∧ 5°E ≤ longitude ≤ 16°E",
            "INS fix remains inside the configured operating region.",
        ),
        "MSG_AFDX_VL_RADIO_POSITION": (
            "48°N ≤ latitude ≤ 54.5°N ∧ 6°E ≤ longitude ≤ 15.5°E",
            "Radio-navigation fix remains inside navaid coverage.",
        ),
        "MSG_AFDX_VL_AIR_DATA": (
            "−2,000 ≤ altitude ≤ 60,000 ft ∧ |vertical speed| ≤ 10,000 fpm ∧ 40 ≤ IAS ≤ 650 kt",
            "All packed air-data fields pass their plausibility ranges.",
        ),
        "MSG_AFDX_VL_ATTITUDE": (
            "|pitch| ≤ 90° ∧ |roll| ≤ 180° ∧ 0° ≤ heading < 360°",
            "All decoded attitude fields are physically representable.",
        ),
        "MSG_AFDX_VL_WEATHER": (
            "wind ≤ 250 kt ∧ turbulence ∈ [0,3] ∧ icing ∈ [0,3]",
            "Weather fields remain inside their declared encoding ranges.",
        ),
        "MSG_AFDX_VL_NAV_DEGRADED_SOLUTION": (
            "route-consistent source pair ∧ degraded flag",
            "Two corroborating sources still support the selected fix.",
        ),
        "MSG_AFDX_VL_NAV_REJECT": (
            "no corroborated navigation solution",
            "The navigation input is rejected instead of receiving flight authority.",
        ),
        "MSG_AFDX_VL_FMS_TRACK_POSITION": (
            "longitude error band ⇒ bank demand {0°, ±15°, ±45°, ±70°}",
            "The FMS selects a discrete lateral command from route error.",
        ),
        "MSG_AFDX_VL_FLIGHT_GUIDANCE": (
            "|Δpitch| ≤ 12° ∧ |Δroll| ≤ 25°",
            "Attitude feedback correction is bounded before command publication.",
        ),
        "MSG_AFDX_VL_ACTUATOR_COMMAND": (
            "|pitch command| ≤ 25° ∧ |roll command| ≤ 70°",
            "Mechanical actuator travel is wider than the intended flight envelope.",
        ),
        "MSG_AFDX_VL_ACTUATOR_ALERT": (
            "command outside mechanical travel ∨ upstream envelope alert",
            "The actuator rejects the command or forwards a protection alert.",
        ),
        "MSG_AFDX_VL_AIRCRAFT_ATTITUDE_STATE": (
            "|pitch| ≤ 18° ∧ |roll| ≤ 32°",
            "Observed aircraft attitude remains inside the configured safety envelope.",
        ),
        "MSG_AFDX_VL_AIRCRAFT_UNSAFE_STATE": (
            "|pitch| > 18° ∨ |roll| > 32°",
            "A reachable aircraft-attitude safety violation exists.",
        ),
        "MSG_AFDX_VL_AIRCRAFT_POSITION_STATE": (
            "position inside configured route corridor",
            "Observed aircraft position remains inside the route monitor.",
        ),
        "MSG_AFDX_VL_AIRCRAFT_DIVERGED_STATE": (
            "position outside configured route corridor",
            "A reachable geographic course-diversion state exists.",
        ),
        "MSG_AFDX_VL_ROUTE_ACTIVE": (
            "validated route revision ∧ active leg inside geographic corridor",
            "The loaded route is accepted for FMS use.",
        ),
        "MSG_AFDX_VL_ROUTE_REJECT": (
            "invalid route revision ∨ active leg outside corridor",
            "The route-integrity guard rejects the loaded route.",
        ),
        "MSG_AFDX_VL_INGRESS_REJECT": (
            "publisher ∉ AFDX virtual-link allow-list",
            "The control-domain ingress guard rejects an unauthorized publisher.",
        ),
        "MSG_AFDX_VL_RADIO_HEIGHT": (
            "valid radio-height channel ∧ channel agreement",
            "A monitored height-above-ground value is available.",
        ),
        "MSG_AFDX_VL_RADIO_HEIGHT_UNAVAILABLE": (
            "no valid corroborated radio-height channel",
            "Radio height is declared unavailable rather than trusted.",
        ),
    }

    if message_type == "MSG_AFDX_VL_NAV_SOLUTION":
        if profile == "vulnerable":
            formula = "syntactically valid GNSS fix ⇒ navigation authority"
            meaning = "No independent INS/radio consistency check is added."
        else:
            formula = "route-consistent fix ∧ agreement of at least 2 navigation sources"
            meaning = "The secure fusion requires independent corroboration."
    elif message_type == "MSG_AFDX_VL_ENVELOPE_COMMAND":
        if profile == "vulnerable":
            formula = "NAV_DIRECT ∨ (|pitch| ≤ 18° ∧ |roll| ≤ 32°)"
            meaning = "NAV_DIRECT can bypass the normal software envelope limits."
        else:
            formula = "|pitch command| ≤ 18° ∧ |roll command| ≤ 32°"
            meaning = "The secure limiter always clamps the command before actuation."
    else:
        formula, meaning = common.get(message_type, (
            _humanize(message_type),
            f"{predicate_count} exact symbolic predicate{'s' if predicate_count != 1 else ''} retained below.",
        ))

    return {
        "constraint_readable": formula,
        "constraint_meaning": meaning,
        "predicate_count": predicate_count,
    }
