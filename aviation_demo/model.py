"""Shared routes, attack graphs, and safety settings for the demo.

Coordinates are WGS84 and intended solely for the research demonstrator.  The
routes are geographically plausible demo paths between real aerodromes, not
current operational clearances and not navigation data.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Literal


@dataclass(frozen=True)
class RoutePoint:
    id: str
    label: str
    lat: float
    lon: float
    altitude_ft: int


@dataclass(frozen=True)
class FlightPerformance:
    takeoff_roll_seconds: int = 24
    rotate_speed_kt: int = 145
    climb_speed_kt: int = 210
    descent_speed_kt: int = 190
    approach_speed_kt: int = 140
    max_climb_fpm: int = 4_000
    max_descent_fpm: int = 2_500


@dataclass(frozen=True)
class Route:
    id: str
    name: str
    origin: str
    destination: str
    cruise_speed_kt: int
    performance: FlightPerformance
    points: tuple[RoutePoint, ...]
    note: str = "Geographic research route - not for operational navigation."


@dataclass(frozen=True)
class AttackStep:
    id: str
    label: str
    component: str
    at_seconds: int
    kind: str
    depends_on: tuple[str, ...]
    note: str
    secure_status: str
    vulnerable_status: str


MagnitudeKey = Literal[
    "gps_bias_m",
    "gps_bias_rate_mps",
    "radio_bias_m",
    "route_offset_m",
    "roll_injection_deg",
    "radio_altimeter_loss",
    "crosswind_mps",
    "vertical_gust_mps",
    "nav_output_bias_m",
    "fms_steering_dropout",
    "navigation_loss",
    "stale_roll_bound_deg",
    "stale_pitch_bound_deg",
    "mcdu_altitude_offset_ft",
    "airspeed_bias_kt",
]


@dataclass(frozen=True)
class ScenarioEffect:
    trigger: str
    phase_gate: tuple[str, ...]
    max_agl_ft: int | None
    rise_seconds: float
    duration_seconds: float | None
    fall_seconds: float
    waveform: str
    analysis_activation_seconds: int


@dataclass(frozen=True)
class ScenarioEvidence:
    coverage: str
    native_components: tuple[str, ...]
    message_types: tuple[str, ...]
    note: str


@dataclass(frozen=True)
class AttackScenario:
    id: str
    title: str
    category: str
    summary: str
    source: str
    activation_seconds: int
    magnitude: dict[MagnitudeKey, float]
    signal_property: str
    attack_surface: str
    preconditions: tuple[str, ...]
    operating_window: str
    detection: tuple[str, ...]
    hazard: str
    effect: ScenarioEffect
    evidence: ScenarioEvidence
    secure_response: str
    vulnerable_response: str
    steps: tuple[AttackStep, ...]
    tags: tuple[str, ...]


ROUTES: tuple[Route, ...] = (
    Route(
        id="eddb-eddp",
        name="Berlin Brandenburg to Leipzig/Halle",
        origin="EDDB / BER",
        destination="EDDP / LEJ",
        cruise_speed_kt=260,
        performance=FlightPerformance(),
        points=(
            RoutePoint("EDDB", "EDDB 25R", 52.362137, 13.500070, 157),
            RoutePoint("B25R", "Runway-heading departure", 52.353518, 13.461329, 500),
            RoutePoint("BCL1", "Initial climb", 52.346738, 13.430901, 1_800),
            RoutePoint("D01", "Demo departure", 52.2450, 13.4200, 7_000),
            RoutePoint("D02", "Demo en-route 1", 52.0300, 13.1800, 12_000),
            RoutePoint("D03", "Demo en-route 2", 51.7900, 12.8600, 12_000),
            RoutePoint("D04", "Demo arrival", 51.5850, 12.5200, 6_000),
            RoutePoint("EDDP", "EDDP 26L", 51.421060, 12.236550, 470),
        ),
    ),
    Route(
        id="eddm-lows",
        name="Munich to Salzburg",
        origin="EDDM / MUC",
        destination="LOWS / SZG",
        cruise_speed_kt=240,
        performance=FlightPerformance(
            rotate_speed_kt=140,
            climb_speed_kt=195,
            descent_speed_kt=180,
            approach_speed_kt=135,
            max_climb_fpm=3_500,
        ),
        points=(
            RoutePoint("EDDM", "EDDM 08R", 48.353783, 11.786086, 1_487),
            RoutePoint("M08R", "Runway-heading departure", 48.358150, 11.823406, 1_900),
            RoutePoint("MCL1", "Initial climb", 48.361572, 11.852734, 2_800),
            RoutePoint("A01", "Demo departure", 48.2200, 11.9600, 7_000),
            RoutePoint("A02", "Demo en-route", 48.0500, 12.3300, 10_000),
            RoutePoint("A03", "Demo arrival", 47.9000, 12.6800, 6_000),
            RoutePoint("LOWS", "LOWS 15", 47.793300, 13.004300, 1_411),
        ),
    ),
)


ATTACK_SCENARIOS: tuple[AttackScenario, ...] = (
    AttackScenario(
        id="gnss_spoof",
        title="Lone GNSS spoof",
        category="cyber",
        summary="A ground transmitter introduces a slow, protocol-valid lateral position bias.",
        source="D2.5 pp. 43–49; Don't Panic pp. 6–8",
        activation_seconds=75,
        magnitude={"gps_bias_m": 4500, "gps_bias_rate_mps": 45},
        signal_property="integrity",
        attack_surface="GNSS RF signal at the receiver antenna",
        preconditions=("The aircraft is airborne and FMS lateral guidance is active.", "The transmitter can overpower the authentic GNSS signal with a plausible carry-off fix."),
        operating_window="Climb, cruise, or descent with flight director or autopilot following FMS guidance.",
        detection=("GNSS-to-INS/radio residual exceeds 45 m", "Route and kinematic consistency monitor"),
        hazard="H1/H3: loss of separation or inability to follow the cleared route.",
        effect=ScenarioEffect(
            trigger="elapsed_time_and_phase", phase_gate=("CLIMB", "CRUISE", "DESCENT"), max_agl_ft=None,
            rise_seconds=100, duration_seconds=None, fall_seconds=0,
            waveform="linear", analysis_activation_seconds=30,
        ),
        evidence=ScenarioEvidence(
            coverage="native", native_components=("gnss_receiver", "inertial_reference", "radio_navigation", "navigation_fusion", "flight_management", "flight_guidance", "aircraft_effect"),
            message_types=("MSG_AFDX_VL_GNSS_POSITION", "MSG_AFDX_VL_INS_POSITION", "MSG_AFDX_VL_RADIO_POSITION", "MSG_AFDX_VL_NAV_SOLUTION", "MSG_AFDX_VL_NAV_REJECT", "MSG_AFDX_VL_FMS_TARGET", "MSG_AFDX_VL_FLIGHT_GUIDANCE"), note="angr covers the native receiver-to-aircraft message chain; RF overpower and carry-off timing are configured preconditions.",
        ),
        secure_response="INS/radio weighted voting rejects the inconsistent GNSS source.",
        vulnerable_response="GNSS-overtrust feeds the false fix to FMS lateral guidance.",
        steps=(
            AttackStep(
                id="tx", label="RF overpower begins", component="external_gnss", at_seconds=55, kind="attempt",
                depends_on=(), note="External RF access is a configured attacker capability, not an onboard network privilege.",
                secure_status="attempted", vulnerable_status="attempted",
            ),
            AttackStep(
                id="bias", label="Plausible fix carries off", component="gnss_receiver", at_seconds=75, kind="propagate",
                depends_on=("tx",), note="The payload remains inside the native fixed-point coordinate syntax.",
                secure_status="propagated", vulnerable_status="propagated",
            ),
            AttackStep(
                id="vote", label="Navigation consistency vote", component="navigation_fusion", at_seconds=80, kind="decision",
                depends_on=("bias",), note="The protected fusion compares independent sources; the baseline grants GNSS navigation authority.",
                secure_status="blocked", vulnerable_status="propagated",
            ),
            AttackStep(
                id="guide", label="False lateral guidance", component="flight_management", at_seconds=90, kind="effect",
                depends_on=("vote",), note="Only the vulnerable lineage reaches the FMS track and aircraft position effect.",
                secure_status="blocked", vulnerable_status="unsafe",
            ),
        ),
        tags=("GNSS", "integrity", "navigation"),
    ),
    AttackScenario(
        id="gnss_degraded_mode",
        title="GNSS spoof in degraded navigation",
        category="combined",
        summary="Radio navigation and INS are independently unavailable before GNSS is spoofed.",
        source="D2.5 TS-1, pp. 43–49; Don't Panic pp. 6–9",
        activation_seconds=65,
        magnitude={"gps_bias_m": 7000, "gps_bias_rate_mps": 70},
        signal_property="integrity + availability",
        attack_surface="Navigation-source failures followed by GNSS RF spoofing",
        preconditions=("Radio Position unavailable", "INS Position unavailable independently", "Autopilot engaged in GNSS-only contingency mode"),
        operating_window="Airborne degraded navigation during climb, cruise, or descent.",
        detection=("GNSS-only annunciation", "Independent geographic monitor", "Required-navigation-performance alert"),
        hazard="TS-1 / UCA1: unreliable FMS steering can cause H1-H3.",
        effect=ScenarioEffect(
            trigger="elapsed_time_and_phase", phase_gate=("CLIMB", "CRUISE", "DESCENT"), max_agl_ft=None,
            rise_seconds=100, duration_seconds=None, fall_seconds=0,
            waveform="linear", analysis_activation_seconds=30,
        ),
        evidence=ScenarioEvidence(
            coverage="partial", native_components=("gnss_receiver", "inertial_reference", "radio_navigation", "navigation_fusion", "flight_management", "flight_guidance", "aircraft_effect"),
            message_types=("MSG_AFDX_VL_GNSS_POSITION", "MSG_AFDX_VL_SENSOR_ALERT", "MSG_AFDX_VL_NAV_DEGRADED_SOLUTION", "MSG_AFDX_VL_NAV_REJECT", "MSG_AFDX_VL_FMS_TARGET"), note="Native payload handlers are analyzed; ordered independent failures and the GNSS-only window are configured guards.",
        ),
        secure_response="Independent geographic monitor holds the last verified path and disengages autoflight.",
        vulnerable_response="GNSS-only mode accepts the false position and commands a diversion.",
        steps=(
            AttackStep(
                id="radio", label="Radio position unavailable", component="radio_navigation", at_seconds=25, kind="fault",
                depends_on=(), note="VOR/DME-style radio navigation, not radio altitude.",
                secure_status="propagated", vulnerable_status="propagated",
            ),
            AttackStep(
                id="ins", label="INS position unavailable", component="inertial_reference", at_seconds=40, kind="fault",
                depends_on=(), note="TS-1 requires availability loss, not reduced precision.",
                secure_status="propagated", vulnerable_status="propagated",
            ),
            AttackStep(
                id="tx", label="GNSS signal spoofed", component="gnss_receiver", at_seconds=65, kind="attempt",
                depends_on=("radio", "ins"), note="Safety relevance begins after both independent losses.",
                secure_status="attempted", vulnerable_status="attempted",
            ),
            AttackStep(
                id="mode", label="GNSS-only authority requested", component="navigation_fusion", at_seconds=72, kind="decision",
                depends_on=("tx",), note="Protected autoflight requires an independent geographic check.",
                secure_status="blocked", vulnerable_status="propagated",
            ),
            AttackStep(
                id="guide", label="False course command", component="flight_management", at_seconds=82, kind="effect",
                depends_on=("mode",), note="The vulnerable aircraft tracks the GNSS-only solution.",
                secure_status="blocked", vulnerable_status="unsafe",
            ),
        ),
        tags=("GNSS", "INS", "availability", "mixed"),
    ),
    AttackScenario(
        id="coherent_nav_spoof",
        title="Coherent GNSS and radio deception",
        category="cyber",
        summary="GNSS and radio navigation agree on one false position and challenge a simple majority voter.",
        source="D2.5 Fig. 4, pp. 43–45; Don't Panic Fig. 7, pp. 6–7",
        activation_seconds=95,
        magnitude={"gps_bias_m": 5500, "gps_bias_rate_mps": 55, "radio_bias_m": 5500},
        signal_property="integrity",
        attack_surface="GNSS RF and radio-navigation position inputs",
        preconditions=("Integrity attacks affect both GNSS Position and Radio Position", "The false pair is mutually consistent", "FMS guidance is active"),
        operating_window="Airborne navigation, especially modes that permit an agreeing external pair to outrank INS.",
        detection=("Route-corridor residual", "Inertial-dynamics residual", "Source-diversity integrity monitor"),
        hazard="Integrity(GNSS Position) AND Integrity(Radio Position) can lead to UCA1 and H1/H3.",
        effect=ScenarioEffect(
            trigger="elapsed_time_and_phase", phase_gate=("CLIMB", "CRUISE", "DESCENT"), max_agl_ft=None,
            rise_seconds=100, duration_seconds=None, fall_seconds=0,
            waveform="linear", analysis_activation_seconds=30,
        ),
        evidence=ScenarioEvidence(
            coverage="partial", native_components=("gnss_receiver", "radio_navigation", "inertial_reference", "navigation_fusion", "flight_management", "flight_guidance", "aircraft_effect"),
            message_types=("MSG_AFDX_VL_GNSS_POSITION", "MSG_AFDX_VL_RADIO_POSITION", "MSG_AFDX_VL_INS_POSITION", "MSG_AFDX_VL_NAV_DEGRADED_SOLUTION", "MSG_AFDX_VL_FMS_TARGET"), note="All native handlers are analyzed; correlation between the two deceptions is an explicit configured AND precondition.",
        ),
        secure_response="A route-aided inertial monitor rejects the agreeing but dynamically implausible external pair.",
        vulnerable_response="A majority-only voter accepts the false pair and commands a diversion.",
        steps=(
            AttackStep(
                id="coordinate", label="Two-source deception coordinated", component="external_navigation_attacker", at_seconds=55, kind="attempt",
                depends_on=(), note="Two distinct channels carry a consistent false state.",
                secure_status="attempted", vulnerable_status="attempted",
            ),
            AttackStep(
                id="gnss", label="GNSS false position emitted", component="gnss_receiver", at_seconds=70, kind="propagate",
                depends_on=("coordinate",), note="The GNSS payload remains syntactically valid.",
                secure_status="propagated", vulnerable_status="propagated",
            ),
            AttackStep(
                id="radio", label="Matching radio position emitted", component="radio_navigation", at_seconds=75, kind="propagate",
                depends_on=("coordinate",), note="Radio Position is distinct from radio height.",
                secure_status="propagated", vulnerable_status="propagated",
            ),
            AttackStep(
                id="pair", label="False pair reaches fusion", component="navigation_fusion", at_seconds=95, kind="decision",
                depends_on=("gnss", "radio"), note="Dependencies preserve the AND semantics.",
                secure_status="blocked", vulnerable_status="propagated",
            ),
            AttackStep(
                id="guide", label="Coherent diversion commanded", component="flight_management", at_seconds=110, kind="effect",
                depends_on=("pair",), note="Only the vulnerable lineage reaches guidance.",
                secure_status="blocked", vulnerable_status="unsafe",
            ),
        ),
        tags=("GNSS", "radio-navigation", "integrity", "coordinated"),
    ),
    AttackScenario(
        id="efb_map_tamper",
        title="EFB to flight-plan tampering",
        category="cyber",
        summary="A preflight EFB/DLS chain persists a modified route until the affected leg activates.",
        source="D2.5 TS-2 and attack graph, pp. 45–53; Don't Panic pp. 8–9",
        activation_seconds=140,
        magnitude={"route_offset_m": 6000},
        signal_property="integrity",
        attack_surface="Airline network, EFB, DLS, and route-loading boundary",
        preconditions=("EFB reachable from internet or airline network", "EFB privilege reaches DLS before departure", "Modified route is loaded preflight"),
        operating_window="Preflight compromise and load; altered leg activates near T+140 in climb or cruise.",
        detection=("Signed route-load verification", "Route hash and provenance check", "Crew waypoint cross-check"),
        hazard="TS-2 / H1-H3: corrupt map or route data alters FMS guidance.",
        effect=ScenarioEffect(
            trigger="elapsed_time_and_phase", phase_gate=("CLIMB", "CRUISE"), max_agl_ft=None,
            rise_seconds=15, duration_seconds=None, fall_seconds=0,
            waveform="smoothstep", analysis_activation_seconds=30,
        ),
        evidence=ScenarioEvidence(
            coverage="partial", native_components=("data_loader", "route_integrity", "flight_management", "flight_guidance", "aircraft_effect"),
            message_types=("MSG_AFDX_ASD_DLS_ROUTE_LOAD", "MSG_AFDX_VL_ROUTE_ACTIVE", "MSG_AFDX_VL_ROUTE_REJECT", "MSG_AFDX_VL_FMS_TARGET"), note="Loader-to-FMS processing is native; internet and enterprise exploit routes remain configured attack-graph evidence.",
        ),
        secure_response="Domain gateway and signed-route validation stop the modified plan at the loader.",
        vulnerable_response="The FMS accepts the modified leg and tracks the attacker-selected offset.",
        steps=(
            AttackStep(
                id="internet", label="Preflight external foothold", component="external_airline_network", at_seconds=0, kind="attempt",
                depends_on=(), note="Direct internet or longer enterprise route.",
                secure_status="attempted", vulnerable_status="attempted",
            ),
            AttackStep(
                id="efb", label="EFB privilege acquired", component="external_efb", at_seconds=10, kind="exploit",
                depends_on=("internet",), note="The paper’s assumed vulnerabilities are predicates, not operational claims.",
                secure_status="attempted", vulnerable_status="propagated",
            ),
            AttackStep(
                id="dls", label="Route load reaches DLS", component="data_loader", at_seconds=22, kind="propagate",
                depends_on=("efb",), note="First native aircraft-side component.",
                secure_status="propagated", vulnerable_status="propagated",
            ),
            AttackStep(
                id="validate", label="Route provenance checked", component="route_integrity", at_seconds=32, kind="decision",
                depends_on=("dls",), note="Signed validation is a demonstrator safeguard.",
                secure_status="blocked", vulnerable_status="propagated",
            ),
            AttackStep(
                id="stored", label="Modified route persists preflight", component="route_integrity", at_seconds=40, kind="propagate",
                depends_on=("validate",), note="Armed without a motion effect until leg activation.",
                secure_status="blocked", vulnerable_status="armed",
            ),
            AttackStep(
                id="load", label="Affected leg activates", component="flight_management", at_seconds=140, kind="effect",
                depends_on=("stored",), note="Separates compromise from flight consequence.",
                secure_status="blocked", vulnerable_status="unsafe",
            ),
        ),
        tags=("EFB", "DLS", "map", "integrity"),
    ),
    AttackScenario(
        id="afdx_injection",
        title="Control-domain bus injection",
        category="cyber",
        summary="A compromised control-domain host publishes a valid-label forged bank request.",
        source="Demonstrator concretization of D2.5 control-domain integrity paths, pp. 38–49",
        activation_seconds=90,
        magnitude={"roll_injection_deg": 48},
        signal_property="integrity",
        attack_surface="Control-domain ingress and AFDX-inspired guidance virtual link",
        preconditions=("A publisher or ingress path is compromised", "Autoflight consumes the forged guidance request"),
        operating_window="Airborne with flight guidance and actuator control active.",
        detection=("Ingress source allow-list", "Virtual-link provenance check", "Independent 32 degree bank guard"),
        hazard="Demonstrator unsafe-attitude state; the paper provides the privilege path, not this exact bank command.",
        effect=ScenarioEffect(
            trigger="elapsed_time_and_phase", phase_gate=("CLIMB", "CRUISE", "DESCENT", "APPROACH"), max_agl_ft=None,
            rise_seconds=1, duration_seconds=18, fall_seconds=2,
            waveform="smoothstep", analysis_activation_seconds=30,
        ),
        evidence=ScenarioEvidence(
            coverage="native", native_components=("control_domain_ingress", "afdx_ingress_guard", "flight_guidance", "envelope_protection", "actuator_control", "aircraft_effect"),
            message_types=("MSG_AFDX_VL_UNTRUSTED_GUIDANCE", "MSG_AFDX_VL_INGRESS_REJECT", "MSG_AFDX_VL_FLIGHT_GUIDANCE", "MSG_AFDX_VL_ENVELOPE_COMMAND", "MSG_AFDX_VL_ENVELOPE_ALERT", "MSG_AFDX_VL_ACTUATOR_COMMAND", "MSG_AFDX_VL_AIRCRAFT_UNSAFE_STATE"), note="The aircraft-side ingress-to-unsafe-state chain is implemented as native MCA components.",
        ),
        secure_response="Virtual-link allow-listing and the independent envelope limiter reject/clamp the frame.",
        vulnerable_response="The unauthenticated request reaches the actuator manager.",
        steps=(
            AttackStep(
                id="host", label="Control publisher compromised", component="external_control_host", at_seconds=50, kind="exploit",
                depends_on=(), note="Initial privilege is a configured precondition.",
                secure_status="attempted", vulnerable_status="attempted",
            ),
            AttackStep(
                id="frame", label="Untrusted guidance arrives", component="control_domain_ingress", at_seconds=90, kind="propagate",
                depends_on=("host",), note="Valid-looking guidance label.",
                secure_status="propagated", vulnerable_status="propagated",
            ),
            AttackStep(
                id="guard", label="Ingress provenance evaluated", component="afdx_ingress_guard", at_seconds=91, kind="decision",
                depends_on=("frame",), note="Secure emits INGRESS_REJECT.",
                secure_status="blocked", vulnerable_status="propagated",
            ),
            AttackStep(
                id="fcc", label="Forged bank request processed", component="flight_guidance", at_seconds=95, kind="propagate",
                depends_on=("guard",), note="Blocked in protected profile.",
                secure_status="blocked", vulnerable_status="propagated",
            ),
            AttackStep(
                id="envelope", label="Bank envelope applied", component="envelope_protection", at_seconds=97, kind="decision",
                depends_on=("fcc",), note="Independent guard caps bank.",
                secure_status="blocked", vulnerable_status="propagated",
            ),
            AttackStep(
                id="act", label="Unsafe aileron command", component="actuator_control", at_seconds=100, kind="effect",
                depends_on=("envelope",), note="Finite unsafe roll pulse.",
                secure_status="blocked", vulnerable_status="unsafe",
            ),
        ),
        tags=("AFDX", "command", "integrity"),
    ),
    AttackScenario(
        id="nav_output_tamper",
        title="Post-fusion navigation-output tampering",
        category="cyber",
        summary="A forged navigation solution is injected after sensor fusion, bypassing GNSS/INS/radio voting.",
        source="D2.5 Fig. 4/Table 5, pp. 45–49; Don't Panic pp. 7–8",
        activation_seconds=115,
        magnitude={"nav_output_bias_m": 5000},
        signal_property="integrity",
        attack_surface="Control-domain navigation-solution virtual link",
        preconditions=("Post-fusion publishing access", "FMS lateral guidance active"),
        operating_window="Airborne FMS-guided climb, cruise, or descent.",
        detection=("Ingress provenance guard", "Navigation freshness check", "Independent route monitor"),
        hazard="Integrity(Navigation System Position) can produce UCA1 and H1/H3.",
        effect=ScenarioEffect(
            trigger="elapsed_time_and_phase", phase_gate=("CLIMB", "CRUISE", "DESCENT"), max_agl_ft=None,
            rise_seconds=60, duration_seconds=None, fall_seconds=0,
            waveform="linear", analysis_activation_seconds=30,
        ),
        evidence=ScenarioEvidence(
            coverage="native", native_components=("control_domain_ingress", "afdx_ingress_guard", "flight_management", "flight_guidance", "aircraft_effect"),
            message_types=("MSG_AFDX_VL_UNTRUSTED_NAV", "MSG_AFDX_VL_INGRESS_REJECT", "MSG_AFDX_VL_NAV_SOLUTION", "MSG_AFDX_VL_FMS_TARGET", "MSG_AFDX_VL_FMS_TRACK_POSITION", "MSG_AFDX_VL_AIRCRAFT_DIVERGED_STATE"), note="The native injected lineage intentionally starts downstream of navigation_fusion.",
        ),
        secure_response="The ingress guard rejects a navigation solution from an unauthorized publisher.",
        vulnerable_response="The FMS accepts the forged post-fusion position and tracks a false course.",
        steps=(
            AttackStep(
                id="host", label="Control-domain foothold", component="external_control_host", at_seconds=60, kind="exploit",
                depends_on=(), note="Network-access privilege.",
                secure_status="attempted", vulnerable_status="attempted",
            ),
            AttackStep(
                id="frame", label="Forged NavSysOut arrives", component="control_domain_ingress", at_seconds=115, kind="propagate",
                depends_on=("host",), note="Inserted after voting.",
                secure_status="propagated", vulnerable_status="propagated",
            ),
            AttackStep(
                id="guard", label="Navigation publisher checked", component="afdx_ingress_guard", at_seconds=116, kind="decision",
                depends_on=("frame",), note="Unauthorized lineage rejected.",
                secure_status="blocked", vulnerable_status="propagated",
            ),
            AttackStep(
                id="fms", label="False position consumed", component="flight_management", at_seconds=120, kind="propagate",
                depends_on=("guard",), note="Fusion cannot protect its downstream output.",
                secure_status="blocked", vulnerable_status="propagated",
            ),
            AttackStep(
                id="guide", label="Post-fusion diversion commanded", component="flight_guidance", at_seconds=126, kind="effect",
                depends_on=("fms",), note="Course deviation carries off.",
                secure_status="blocked", vulnerable_status="unsafe",
            ),
        ),
        tags=("navigation-output", "AFDX", "integrity", "post-fusion"),
    ),
    AttackScenario(
        id="fms_steering_dos",
        title="FMS steering denial of service",
        category="cyber",
        summary="A compromised path suppresses FMS steering updates while autoflight requires them.",
        source="D2.5 UCA4–UCA8 and Table 5, pp. 41–46; Don't Panic pp. 4, 7–8",
        activation_seconds=155,
        magnitude={"fms_steering_dropout": 1, "stale_roll_bound_deg": 12, "stale_pitch_bound_deg": 8},
        signal_property="availability",
        attack_surface="FMS steering output and control-domain transport",
        preconditions=("Autopilot engaged", "Fresh correction required", "Attacker can suppress the steering update", "Reachability bounds the last accepted command to ±12° bank and ±8° pitch"),
        operating_window="Airborne autoflight; impact depends on a required command and timing.",
        detection=("FMS target age timeout", "Mode-reversion monitor", "Trajectory error monitor"),
        hazard="UCA4-UCA8: absent, late, short, or stale command can cause H1-H3.",
        effect=ScenarioEffect(
            trigger="elapsed_time_and_phase", phase_gate=("CLIMB", "CRUISE", "DESCENT", "APPROACH"), max_agl_ft=None,
            rise_seconds=0, duration_seconds=40, fall_seconds=0,
            waveform="step", analysis_activation_seconds=30,
        ),
        evidence=ScenarioEvidence(
            coverage="configured", native_components=("flight_management", "flight_guidance", "envelope_protection", "aircraft_effect"),
            message_types=("MSG_AFDX_VL_FMS_TARGET", "MSG_AFDX_VL_FLIGHT_GUIDANCE", "MSG_AFDX_VL_ENVELOPE_ALERT"), note="Native output handlers are analyzed; message absence and timeout are temporal scenario semantics.",
        ),
        secure_response="A freshness timeout holds a bounded command and reverts autoflight before trajectory limits are exceeded.",
        vulnerable_response="Stale steering persists silently and the aircraft misses the required correction.",
        steps=(
            AttackStep(
                id="privilege", label="Steering privilege obtained", component="external_control_host", at_seconds=100, kind="exploit",
                depends_on=(), note="Exec(FMS,root) or control-domain access.",
                secure_status="attempted", vulnerable_status="attempted",
            ),
            AttackStep(
                id="drop", label="Required FMS target suppressed", component="flight_management", at_seconds=155, kind="propagate",
                depends_on=("privilege",), note="Finite missing-update window.",
                secure_status="propagated", vulnerable_status="propagated",
            ),
            AttackStep(
                id="timeout", label="Target freshness expires", component="flight_guidance", at_seconds=158, kind="decision",
                depends_on=("drop",), note="Protected profile detects age.",
                secure_status="recovered", vulnerable_status="propagated",
            ),
            AttackStep(
                id="revert", label="Autoflight reversion commanded", component="envelope_protection", at_seconds=160, kind="decision",
                depends_on=("timeout",), note="Freshness is separate from attitude limits.",
                secure_status="recovered", vulnerable_status="propagated",
            ),
            AttackStep(
                id="miss", label="Required correction missed", component="aircraft_effect", at_seconds=165, kind="effect",
                depends_on=("revert",), note="Trajectory error accumulates during dropout.",
                secure_status="recovered", vulnerable_status="unsafe",
            ),
        ),
        tags=("FMS", "DoS", "availability", "autopilot"),
    ),
    AttackScenario(
        id="total_nav_loss",
        title="Total navigation-source loss",
        category="fault",
        summary="GNSS, radio navigation, and INS become unavailable, forcing navigation rejection.",
        source="D2.5 navigation rule 4 and UCA4–UCA8, pp. 42–44; Don't Panic pp. 6–7",
        activation_seconds=175,
        magnitude={"navigation_loss": 1, "stale_roll_bound_deg": 12, "stale_pitch_bound_deg": 8},
        signal_property="availability",
        attack_surface="Independent GNSS, radio-navigation, and inertial source availability",
        preconditions=("All three sources unavailable in one window", "FMS guidance active", "Reachability bounds the frozen command to ±12° bank and ±8° pitch"),
        operating_window="Airborne finite common outage followed by recovery.",
        detection=("Source validity flags", "Navigation timeout", "NAV REJECT annunciation"),
        hazard="UCA4-UCA8 navigation/steering loss can cause H1-H3.",
        effect=ScenarioEffect(
            trigger="elapsed_time_and_phase", phase_gate=("CLIMB", "CRUISE", "DESCENT", "APPROACH"), max_agl_ft=None,
            rise_seconds=0, duration_seconds=50, fall_seconds=0,
            waveform="step", analysis_activation_seconds=30,
        ),
        evidence=ScenarioEvidence(
            coverage="partial", native_components=("gnss_receiver", "radio_navigation", "inertial_reference", "navigation_fusion", "flight_management", "flight_guidance", "aircraft_effect"),
            message_types=("MSG_AFDX_VL_GNSS_ALERT", "MSG_AFDX_VL_SENSOR_ALERT", "MSG_AFDX_VL_NAV_REJECT", "MSG_AFDX_VL_FMS_TARGET"), note="Alert/reject handlers are native; simultaneous outage timing and recovery are configured guards.",
        ),
        secure_response="Timeouts produce NAV REJECT, annunciation, and bounded autoflight reversion.",
        vulnerable_response="The baseline retains stale navigation and misses route or altitude corrections.",
        steps=(
            AttackStep(
                id="gnss", label="GNSS source unavailable", component="gnss_receiver", at_seconds=160, kind="fault",
                depends_on=(), note="First cut-set input.",
                secure_status="propagated", vulnerable_status="propagated",
            ),
            AttackStep(
                id="radio", label="Radio source unavailable", component="radio_navigation", at_seconds=165, kind="fault",
                depends_on=(), note="VOR/DME-style navigation source.",
                secure_status="propagated", vulnerable_status="propagated",
            ),
            AttackStep(
                id="ins", label="INS source unavailable", component="inertial_reference", at_seconds=170, kind="fault",
                depends_on=(), note="Third cut-set input.",
                secure_status="propagated", vulnerable_status="propagated",
            ),
            AttackStep(
                id="reject", label="Navigation solution unavailable", component="navigation_fusion", at_seconds=175, kind="decision",
                depends_on=("gnss", "radio", "ins"), note="Explicit AND dependencies.",
                secure_status="recovered", vulnerable_status="propagated",
            ),
            AttackStep(
                id="stale", label="Stale guidance persists", component="flight_guidance", at_seconds=185, kind="effect",
                depends_on=("reject",), note="Protected mode reversion contains the outage.",
                secure_status="recovered", vulnerable_status="unsafe",
            ),
            AttackStep(
                id="restore", label="Navigation sources recover", component="aircraft_effect", at_seconds=225, kind="decision",
                depends_on=("stale",), note="Finite outage ends.",
                secure_status="recovered", vulnerable_status="recovered",
            ),
        ),
        tags=("navigation", "availability", "fault", "mode-reversion"),
    ),
    AttackScenario(
        id="mcdu_altitude_tamper",
        title="MCDU altitude-target tampering",
        category="cyber",
        summary="A compromised MCDU-originated altitude request is changed before the FMS applies it.",
        source="D2.5 Fig. 4/Table 5, pp. 45–46; Don't Panic Fig. 7/Table IV, pp. 7–8",
        activation_seconds=135,
        magnitude={"mcdu_altitude_offset_ft": -2500},
        signal_property="integrity",
        attack_surface="MCDU-originated control-domain input to FMS",
        preconditions=("MCDU or MCDU Output integrity compromised", "Autopilot engaged and altitude change permitted"),
        operating_window="Climb, cruise, or descent before a vertical constraint is captured.",
        detection=("Publisher ingress check", "Crew cleared-altitude confirmation", "Vertical-plan integrity check"),
        hazard="Integrity(MCDU/MCDU Output) can produce unsafe Change Altitude actions and H1-H3.",
        effect=ScenarioEffect(
            trigger="elapsed_time_and_phase", phase_gate=("CLIMB", "CRUISE", "DESCENT"), max_agl_ft=None,
            rise_seconds=5, duration_seconds=None, fall_seconds=0,
            waveform="smoothstep", analysis_activation_seconds=30,
        ),
        evidence=ScenarioEvidence(
            coverage="partial", native_components=("control_domain_ingress", "afdx_ingress_guard", "flight_management", "flight_guidance", "envelope_protection", "aircraft_effect"),
            message_types=("MSG_AFDX_VL_UNTRUSTED_GUIDANCE", "MSG_AFDX_VL_INGRESS_REJECT", "MSG_AFDX_VL_FMS_TARGET", "MSG_AFDX_VL_FLIGHT_GUIDANCE"), note="Aircraft-side ingress and FMS lineage are native; MCDU is a configured external publisher.",
        ),
        secure_response="Ingress and vertical-plan monitors reject the target and retain the cleared route altitude.",
        vulnerable_response="The FMS accepts the altered target and commands a 2,500 ft deviation.",
        steps=(
            AttackStep(
                id="mcdu", label="MCDU target altered", component="external_mcdu", at_seconds=80, kind="attempt",
                depends_on=(), note="Direct paper threat branch.",
                secure_status="attempted", vulnerable_status="attempted",
            ),
            AttackStep(
                id="frame", label="Altered altitude request arrives", component="control_domain_ingress", at_seconds=135, kind="propagate",
                depends_on=("mcdu",), note="Distinct from correct route target.",
                secure_status="propagated", vulnerable_status="propagated",
            ),
            AttackStep(
                id="guard", label="Publisher and plan checked", component="afdx_ingress_guard", at_seconds=136, kind="decision",
                depends_on=("frame",), note="Unauthorized lineage rejected.",
                secure_status="blocked", vulnerable_status="propagated",
            ),
            AttackStep(
                id="fms", label="Altered target accepted", component="flight_management", at_seconds=140, kind="propagate",
                depends_on=("guard",), note="Command altitude stays separate from route target.",
                secure_status="blocked", vulnerable_status="propagated",
            ),
            AttackStep(
                id="vertical", label="Unsafe altitude change commanded", component="flight_guidance", at_seconds=145, kind="effect",
                depends_on=("fms",), note="Wrong trajectory can remain inside pitch limits.",
                secure_status="blocked", vulnerable_status="unsafe",
            ),
        ),
        tags=("MCDU", "altitude", "integrity", "FMS"),
    ),
    AttackScenario(
        id="radio_altimeter_fault",
        title="Radio-altimeter / ARINC-429 fault",
        category="fault",
        summary="One radio-altimeter channel becomes unavailable; the monitor must select the healthy side.",
        source="D2.5 pp. 54–57 and Appendix pp. 68–70",
        activation_seconds=105,
        magnitude={"radio_altimeter_loss": 1},
        signal_property="availability",
        attack_surface="RA antenna/transceiver, ARINC-429 paths, and radio-height monitor",
        preconditions=("RA1 or its path fails", "RA2 remains available", "Approach at or below 2,500 ft AGL"),
        operating_window="Approach only at or below 2,500 ft AGL.",
        detection=("ARINC-429 validity/age", "RA1/RA2 comparator", "Radio-height unavailable annunciation"),
        hazard="Paper top event: loss of one radio-altitude display; downstream degradation is a demonstrator consequence.",
        effect=ScenarioEffect(
            trigger="elapsed_time_and_phase", phase_gate=("APPROACH",), max_agl_ft=2500,
            rise_seconds=0, duration_seconds=None, fall_seconds=0,
            waveform="step", analysis_activation_seconds=30,
        ),
        evidence=ScenarioEvidence(
            coverage="native", native_components=("radio_altimeter_1", "radio_altimeter_2", "radio_height_monitor", "flight_guidance", "aircraft_effect"),
            message_types=("MSG_AFDX_A429_RA1_HEIGHT", "MSG_AFDX_A429_RA1_INVALID", "MSG_AFDX_A429_RA2_HEIGHT", "MSG_AFDX_A429_RA2_INVALID", "MSG_AFDX_VL_RADIO_HEIGHT", "MSG_AFDX_VL_RADIO_HEIGHT_UNAVAILABLE"), note="Native model represents loss/invalidity and redundant selection, not a fabricated altitude bias.",
        ),
        secure_response="The redundant channel is selected and TAWS/autoflight receive a degraded warning.",
        vulnerable_response="The failed side is not rejected, leaving approach automation without valid radio height.",
        steps=(
            AttackStep(
                id="ra1", label="RA1 antenna/transceiver lost", component="radio_altimeter_1", at_seconds=100, kind="fault",
                depends_on=(), note="Source-backed dominant loss branch.",
                secure_status="propagated", vulnerable_status="propagated",
            ),
            AttackStep(
                id="ra2", label="RA2 remains valid", component="radio_altimeter_2", at_seconds=100, kind="propagate",
                depends_on=(), note="Independent redundant side.",
                secure_status="propagated", vulnerable_status="propagated",
            ),
            AttackStep(
                id="invalid", label="RA1 invalid label received", component="radio_height_monitor", at_seconds=105, kind="propagate",
                depends_on=("ra1",), note="Loss/invalidity rather than false height.",
                secure_status="propagated", vulnerable_status="propagated",
            ),
            AttackStep(
                id="select", label="Redundant radio height selected", component="radio_height_monitor", at_seconds=110, kind="decision",
                depends_on=("invalid", "ra2"), note="Secure selects RA2.",
                secure_status="recovered", vulnerable_status="propagated",
            ),
            AttackStep(
                id="approach", label="Approach consumes radio height", component="flight_guidance", at_seconds=115, kind="effect",
                depends_on=("select",), note="Effect waits for approach and <=2,500 ft AGL.",
                secure_status="recovered", vulnerable_status="unsafe",
            ),
        ),
        tags=("radio-altimeter", "ARINC-429", "approach"),
    ),
    AttackScenario(
        id="convective_gust",
        title="Convective crosswind and gust",
        category="environment",
        summary="A finite bounded wind pulse perturbs the aircraft plant; it is not a cyberattack.",
        source="Demonstrator extension (not present in the supplied papers)",
        activation_seconds=70,
        magnitude={"crosswind_mps": 13, "vertical_gust_mps": 3.5},
        signal_property="physical disturbance",
        attack_surface="Aircraft plant and atmospheric disturbance inputs",
        preconditions=("Aircraft enters the configured gust cell", "Disturbance remains inside declared bounds"),
        operating_window="Finite airborne pulse during climb or cruise; recovers after 58 seconds.",
        detection=("Attitude/track error", "Air-data/inertial residual", "Envelope monitor"),
        hazard="Plant-only transient course or attitude excursion; not in the supplied papers.",
        effect=ScenarioEffect(
            trigger="elapsed_time_and_phase", phase_gate=("CLIMB", "CRUISE"), max_agl_ft=None,
            rise_seconds=8, duration_seconds=35, fall_seconds=15,
            waveform="smoothstep", analysis_activation_seconds=30,
        ),
        evidence=ScenarioEvidence(
            coverage="plant", native_components=(),
            message_types=(), note="Bounded plant evaluation only; no angr/MCA claim is made for atmospheric wind.",
        ),
        secure_response="The flight controller compensates while the envelope guard limits bank and pitch.",
        vulnerable_response="Reactive-only control permits a larger transient deviation without weather/air-data feed-forward.",
        steps=(
            AttackStep(
                id="cell", label="Finite gust cell entered", component="external_weather", at_seconds=70, kind="environment",
                depends_on=(), note="Bounded plant input.",
                secure_status="propagated", vulnerable_status="propagated",
            ),
            AttackStep(
                id="air", label="Aircraft motion disturbed", component="aircraft_effect", at_seconds=74, kind="propagate",
                depends_on=("cell",), note="Crosswind and vertical gust act on motion.",
                secure_status="propagated", vulnerable_status="propagated",
            ),
            AttackStep(
                id="control", label="Controller compensates", component="flight_guidance", at_seconds=80, kind="decision",
                depends_on=("air",), note="Protected response remains bounded.",
                secure_status="recovered", vulnerable_status="unsafe",
            ),
            AttackStep(
                id="clear", label="Gust pulse clears", component="aircraft_effect", at_seconds=128, kind="effect",
                depends_on=("control",), note="Disturbance falls back to zero.",
                secure_status="recovered", vulnerable_status="recovered",
            ),
        ),
        tags=("weather", "wind", "physical"),
    ),
)

SAFETY_DEFAULTS: dict[str, float] = {
    "max_roll_deg": 32.0,
    "max_pitch_deg": 20.0,
    "max_yaw_rate_deg_s": 3.0,
    "max_course_deviation_nm": 1.0,
    "max_altitude_deviation_ft": 1_000.0,
}


def public_config() -> dict[str, Any]:
    return {
        "routes": [asdict(route) for route in ROUTES],
        "attacks": [asdict(attack) for attack in ATTACK_SCENARIOS],
        "safety_defaults": SAFETY_DEFAULTS,
        "analysis_scope": {
            "default_horizon_seconds": 180,
            "default_step_seconds": 6,
            "simulation_horizon_seconds": 1_500,
            "coordinate_system": "local route frame (metres), displayed as WGS84",
            "position_claim": "All states within the declared scenario-relative horizon and external-input bounds, with selected operating gates assumed satisfied.",
            "bus_model": "ARINC-664/AFDX-inspired logical channels over the analyser's fixed-width message protocol",
        },
    }


def attack_by_id(attack_id: str) -> AttackScenario:
    for attack in ATTACK_SCENARIOS:
        if attack.id == attack_id:
            return attack
    raise KeyError(f"Unknown attack scenario: {attack_id}")


def route_by_id(route_id: str) -> Route:
    for route in ROUTES:
        if route.id == route_id:
            return route
    raise KeyError(f"Unknown route: {route_id}")
