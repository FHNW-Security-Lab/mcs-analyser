"""Bounded fixed-step reachability for the aircraft demonstration.

This module is intentionally separate from the MCS binary analyzer. MCS
discovers feasible component message chains; this bounded model adds a
simplified coordinated-turn plant and checks physical and functional safety
properties over a finite, scenario-relative horizon. The exported proof tube
is a conservative zonotope abstraction; the Z3 transition encoding is retained
for diagnostic counterexample work and is not silently used after a timeout.
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
import math
from typing import Any, Iterable

import z3

from .model import ATTACK_SCENARIOS, SAFETY_DEFAULTS, attack_by_id


def _q(value: float | int) -> z3.RatNumRef:
    fraction = Fraction(str(value))
    return z3.Q(fraction.numerator, fraction.denominator)


def _abs(value: z3.ArithRef) -> z3.ArithRef:
    return z3.If(value >= 0, value, -value)


def _clamp(value: z3.ArithRef, low: float, high: float) -> z3.ArithRef:
    return z3.If(value < _q(low), _q(low), z3.If(value > _q(high), _q(high), value))


def _median3(a: z3.ArithRef, b: z3.ArithRef, c: z3.ArithRef) -> z3.ArithRef:
    return z3.If(
        a <= b,
        z3.If(b <= c, b, z3.If(a <= c, c, a)),
        z3.If(a <= c, a, z3.If(b <= c, c, b)),
    )


def _number(value: z3.ArithRef | z3.RatNumRef, model: z3.ModelRef) -> float:
    evaluated = model.eval(value, model_completion=True)
    if z3.is_rational_value(evaluated):
        return float(evaluated.numerator_as_long()) / float(evaluated.denominator_as_long())
    decimal = evaluated.as_decimal(12)
    return float(decimal.rstrip("?"))


def _effect_value(attack: Any, field: str, default: Any) -> Any:
    """Read an effect contract from either a dataclass or legacy mapping."""

    effect = getattr(attack, "effect", None)
    if effect is None:
        return default
    if isinstance(effect, dict):
        return effect.get(field, default)
    return getattr(effect, field, default)


@dataclass
class SymbolicAircraft:
    profile: str
    horizon_seconds: int
    step_seconds: int
    attack_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        if self.profile not in {"secure", "vulnerable"}:
            raise ValueError(f"Unknown profile {self.profile}")
        if self.step_seconds <= 0 or self.horizon_seconds <= 0:
            raise ValueError("Horizon and step must be positive")
        self.steps = self.horizon_seconds // self.step_seconds
        if self.steps < 1 or self.steps > 120:
            raise ValueError("Reachability supports between 1 and 120 time steps")
        self.attacks = tuple(attack_by_id(item) for item in self.attack_ids)
        self.constraints: list[z3.BoolRef] = []
        self._build()

    def _series(self, name: str) -> list[z3.ArithRef]:
        return [z3.Real(f"{self.profile}_{name}_{index}") for index in range(self.steps + 1)]

    def _input_series(self, name: str) -> list[z3.ArithRef]:
        return [z3.Real(f"{self.profile}_{name}_{index}") for index in range(self.steps)]

    def _scenario_bound(self, key: str) -> tuple[float, int]:
        magnitude = 0.0
        activation = self.horizon_seconds + self.step_seconds
        for attack in self.attacks:
            if key in attack.magnitude:
                # This value is an uncertainty radius. Runtime scenarios may
                # declare a signed deterministic direction (for example a
                # -2,500 ft altitude change), but a solver bound must remain
                # non-negative.
                magnitude += abs(float(attack.magnitude[key]))
                activation = min(
                    activation,
                    int(_effect_value(attack, "analysis_activation_seconds", attack.activation_seconds)),
                )
        return magnitude, activation

    @staticmethod
    def _effect_scale(attack: Any, seconds: float) -> float:
        """Return the deterministic scenario-relative effect envelope.

        Phase and AGL gates are converted to a scenario-relative reachability
        start by ``analysis_activation_seconds``. The bounded model therefore
        analyzes the window after the operational trigger instead of pretending
        that an approach-only fault occurs during takeoff.
        """

        activation = float(_effect_value(
            attack, "analysis_activation_seconds", attack.activation_seconds
        ))
        elapsed = seconds - activation
        if elapsed < 0:
            return 0.0

        rise = max(0.0, float(_effect_value(attack, "rise_seconds", 0.0)))
        hold_value = _effect_value(attack, "duration_seconds", None)
        hold = None if hold_value is None else max(0.0, float(hold_value))
        fall = max(0.0, float(_effect_value(attack, "fall_seconds", 0.0)))
        waveform = _effect_value(attack, "waveform", "step")

        if waveform == "sine_pulse":
            total = rise + (hold or 0.0) + fall
            if total <= 0.0 or elapsed > total:
                return 0.0
            return max(0.0, math.sin(math.pi * elapsed / total))

        def shaped(progress: float) -> float:
            value = max(0.0, min(1.0, progress))
            if waveform == "smoothstep":
                return value * value * (3.0 - 2.0 * value)
            if waveform == "step":
                return 1.0
            return value

        if rise > 0.0 and elapsed < rise:
            return shaped(elapsed / rise)
        if hold is None:
            return 1.0
        if elapsed <= rise + hold:
            return 1.0
        if fall <= 0.0 or elapsed > rise + hold + fall:
            return 0.0
        return shaped(1.0 - (elapsed - rise - hold) / fall)

    def _scenario_magnitude_at(self, key: str, seconds: float) -> float:
        """Signed deterministic magnitude used by the boundary replay."""

        return sum(
            float(attack.magnitude.get(key, 0.0)) * self._effect_scale(attack, seconds)
            for attack in self.attacks
        )

    def _scenario_radius_at(self, key: str, seconds: float) -> float:
        """Independent uncertainty radius; opposite scenarios never cancel."""

        return sum(
            abs(float(attack.magnitude.get(key, 0.0)))
            * self._effect_scale(attack, seconds)
            for attack in self.attacks
        )

    def _scenario_active_rate_at(self, key: str, seconds: float) -> float:
        """Unshaped slew bound while a scenario envelope is active."""

        return sum(
            abs(float(attack.magnitude.get(key, 0.0)))
            for attack in self.attacks
            if self._effect_scale(attack, seconds) > 0.0
        )

    def _bounded_input(
        self,
        values: list[z3.ArithRef],
        magnitude_key: str,
        *,
        secure_blocked: bool = False,
        rate_key: str | None = None,
    ) -> None:
        for index, value in enumerate(values):
            seconds = index * self.step_seconds
            bound = self._scenario_radius_at(magnitude_key, seconds)
            if secure_blocked and self.profile == "secure":
                bound = 0.0
            self.constraints.extend((value >= _q(-bound), value <= _q(bound)))
            rate = self._scenario_active_rate_at(rate_key, seconds) if rate_key else 0.0
            if index > 0 and rate and bound:
                delta = rate * self.step_seconds
                self.constraints.append(_abs(value - values[index - 1]) <= _q(delta))

    def _build(self) -> None:
        self.along = self._series("along_m")
        self.cross = self._series("cross_m")
        self.heading = self._series("heading_error_deg")
        self.roll = self._series("roll_deg")
        self.pitch = self._series("pitch_deg")
        self.altitude_error = self._series("altitude_error_m")
        self.yaw_rate = self._series("yaw_rate_deg_s")
        self.estimated_cross = self._series("estimated_cross_m")
        self.commanded_roll = self._series("commanded_roll_deg")

        self.gps_bias = self._input_series("gps_bias_m")
        self.radio_bias = self._input_series("radio_bias_m")
        self.nav_output_bias = self._input_series("nav_output_bias_m")
        self.ins_error = self._input_series("ins_error_m")
        self.radio_error = self._input_series("radio_error_m")
        self.route_offset = self._input_series("route_offset_m")
        self.roll_injection = self._input_series("roll_injection_deg")
        self.pitch_injection = self._input_series("pitch_injection_deg")
        self.fms_dropout = self._input_series("fms_steering_dropout")
        self.navigation_loss = self._input_series("navigation_loss")
        self.stale_roll_command = self._input_series("stale_roll_command_deg")
        self.stale_pitch_command = self._input_series("stale_pitch_command_deg")
        self.mcdu_altitude_offset = self._input_series("mcdu_altitude_offset_ft")
        self.crosswind = self._input_series("crosswind_mps")
        self.vertical_gust = self._input_series("vertical_gust_mps")
        self.along_wind = self._input_series("along_wind_mps")

        self.constraints.extend(
            (
                self.along[0] == 0,
                self.cross[0] == 0,
                self.heading[0] == 0,
                self.roll[0] == 0,
                self.pitch[0] == 0,
                self.altitude_error[0] == 0,
                self.yaw_rate[0] == 0,
                self.estimated_cross[0] == 0,
                self.commanded_roll[0] == 0,
            )
        )

        self._bounded_input(
            self.gps_bias,
            "gps_bias_m",
            rate_key="gps_bias_rate_mps",
        )
        self._bounded_input(self.radio_bias, "radio_bias_m", secure_blocked=True)
        self._bounded_input(self.nav_output_bias, "nav_output_bias_m", secure_blocked=True)
        self._bounded_input(self.route_offset, "route_offset_m", secure_blocked=True)
        self._bounded_input(self.roll_injection, "roll_injection_deg", secure_blocked=True)
        self._bounded_input(self.pitch_injection, "pitch_error_deg", secure_blocked=True)
        self._bounded_input(self.fms_dropout, "fms_steering_dropout", secure_blocked=True)
        self._bounded_input(self.navigation_loss, "navigation_loss", secure_blocked=True)
        self._bounded_input(self.stale_roll_command, "stale_roll_bound_deg", secure_blocked=True)
        self._bounded_input(self.stale_pitch_command, "stale_pitch_bound_deg", secure_blocked=True)
        self._bounded_input(
            self.mcdu_altitude_offset,
            "mcdu_altitude_offset_ft",
            secure_blocked=True,
        )
        self._bounded_input(self.crosswind, "crosswind_mps")
        self._bounded_input(self.vertical_gust, "vertical_gust_mps")

        # Nominal uncertainty always exists, independent of selected attacks.
        for index in range(self.steps):
            self.constraints.extend(
                (
                    self.ins_error[index] >= _q(-40),
                    self.ins_error[index] <= _q(40),
                    self.radio_error[index] >= _q(-25),
                    self.radio_error[index] <= _q(25),
                    # Route-tangent progress may fall to zero after a large
                    # heading error; +8 m/s retains the declared tailwind.
                    self.along_wind[index] >= _q(-135),
                    self.along_wind[index] <= _q(8),
                )
            )

        dt = _q(self.step_seconds)
        for index in range(self.steps):
            gps = self.cross[index] + self.gps_bias[index]
            ins = self.cross[index] + self.ins_error[index]
            radio = self.cross[index] + self.radio_error[index] + self.radio_bias[index]

            if self.profile == "secure":
                # Route-aided monitor residual after source voting/reversion.
                # This remains available for the configured degraded/coherent
                # cases even when a named sensor source is unavailable.
                fused = self.cross[index] + self.ins_error[index]
            else:
                # The baseline trusts GNSS and also accepts an authoritative
                # post-fusion frame without end-to-end publisher validation.
                fused = gps + self.nav_output_bias[index]

            desired_cross = 0 if self.profile == "secure" else self.route_offset[index]
            navigation_error = fused - desired_cross
            fms_roll = _clamp(-_q(0.012) * navigation_error, -32, 32)

            if self.profile == "vulnerable":
                stale_mode = z3.Or(
                    _abs(self.fms_dropout[index]) > 0,
                    _abs(self.navigation_loss[index]) > 0,
                )
                injected = z3.If(
                    _abs(self.roll_injection[index]) > 0,
                    self.roll_injection[index],
                    z3.If(stale_mode, self.stale_roll_command[index], fms_roll),
                )
                roll_command = _clamp(injected, -55, 55)
                commanded_altitude_m = _q(0.3048) * self.mcdu_altitude_offset[index]
                nominal_pitch_command = _clamp(
                    -_q(0.018) * (self.altitude_error[index] - commanded_altitude_m)
                    + self.pitch_injection[index],
                    -28,
                    28,
                )
                pitch_command = z3.If(
                    stale_mode,
                    self.stale_pitch_command[index],
                    nominal_pitch_command,
                )
                response = _q(0.42)
            else:
                roll_command = _clamp(fms_roll, -32, 32)
                pitch_command = _clamp(-_q(0.018) * self.altitude_error[index], -18, 18)
                response = _q(0.42)

            next_roll = self.roll[index] + response * (roll_command - self.roll[index])
            next_pitch = self.pitch[index] + response * (pitch_command - self.pitch[index])
            next_yaw_rate = _q(0.045) * next_roll
            next_heading = self.heading[index] + next_yaw_rate * dt

            # Coordinated-turn small-angle model at 135 m/s:
            # lateral speed ~= V * heading(rad) ~= 2.356 * heading(deg).
            lateral_speed = _q(2.356) * next_heading + self.crosswind[index]
            vertical_speed = _q(2.356) * next_pitch + self.vertical_gust[index]

            self.constraints.extend(
                (
                    self.estimated_cross[index + 1] == fused,
                    self.commanded_roll[index + 1] == roll_command,
                    self.roll[index + 1] == next_roll,
                    self.pitch[index + 1] == next_pitch,
                    self.yaw_rate[index + 1] == next_yaw_rate,
                    self.heading[index + 1] == next_heading,
                    self.cross[index + 1] == self.cross[index] + lateral_speed * dt,
                    self.along[index + 1]
                    == self.along[index] + (_q(135) + self.along_wind[index]) * dt,
                    self.altitude_error[index + 1]
                    == self.altitude_error[index] + vertical_speed * dt,
                )
            )

    def solver(self) -> z3.Solver:
        solver = z3.SolverFor("QF_LRA")
        solver.set(timeout=4_000)
        solver.add(*self.constraints)
        return solver


def _property_check(
    aircraft: SymbolicAircraft,
    expressions: list[z3.ArithRef],
    limit: float,
    unit: str,
) -> dict[str, Any]:
    solver = aircraft.solver()
    solver.add(z3.Or(*(_abs(expression) > _q(limit) for expression in expressions)))
    result = solver.check()
    if result == z3.sat:
        model = solver.model()
        witness_index = next(
            (
                index
                for index, expression in enumerate(expressions)
                if abs(_number(expression, model)) > limit
            ),
            len(expressions) - 1,
        )
        expression = expressions[witness_index]
        return {
            "status": "sat",
            "violated": True,
            "witness_seconds": witness_index * aircraft.step_seconds,
            "limit": limit,
            "unit": unit,
            "witness": round(_number(expression, model), 4),
            "solver": "Z3 SAT counterexample",
        }
    if result == z3.unknown:
        return {
            "status": "unknown",
            "violated": None,
            "witness_seconds": None,
            "limit": limit,
            "unit": unit,
            "witness": None,
            "solver": f"Z3 unknown: {solver.reason_unknown()}",
        }
    return {
        "status": "unsat",
        "violated": False,
        "witness_seconds": None,
        "limit": limit,
        "unit": unit,
        "witness": None,
        "solver": "Z3 UNSAT within configured bounds and horizon",
    }


def _sample_witness(aircraft: SymbolicAircraft, direction: int) -> list[dict[str, float]]:
    """Return a replayable boundary-input trace without an optimization pass."""

    solver = aircraft.solver()
    keyed_inputs = {
        "gps_bias_m": aircraft.gps_bias,
        "route_offset_m": aircraft.route_offset,
        "roll_injection_deg": aircraft.roll_injection,
        "pitch_error_deg": aircraft.pitch_injection,
        "crosswind_mps": aircraft.crosswind,
        "vertical_gust_mps": aircraft.vertical_gust,
    }
    secure_blocked = {"route_offset_m", "roll_injection_deg", "pitch_error_deg"}
    for key, values in keyed_inputs.items():
        magnitude, activation = aircraft._scenario_bound(key)
        if aircraft.profile == "secure" and key in secure_blocked:
            magnitude = 0.0
        rate = None
        if key == "gps_bias_m":
            rate, _ = aircraft._scenario_bound("gps_bias_rate_mps")
        for index, value in enumerate(values):
            seconds = index * aircraft.step_seconds
            if seconds < activation:
                selected = 0.0
            elif rate:
                selected = min(magnitude, rate * (seconds - activation + aircraft.step_seconds))
            else:
                selected = magnitude
            solver.add(value == _q(direction * selected))
    for values in (aircraft.ins_error, aircraft.radio_error, aircraft.along_wind):
        solver.add(*(value == 0 for value in values))

    if solver.check() != z3.sat:
        return []
    model = solver.model()
    stride = max(1, aircraft.steps // 12)
    indexes = sorted(set(range(0, aircraft.steps + 1, stride)) | {aircraft.steps})
    return [
        {
            "seconds": index * aircraft.step_seconds,
            "along_m": round(_number(aircraft.along[index], model), 3),
            "cross_m": round(_number(aircraft.cross[index], model), 3),
            "roll_deg": round(_number(aircraft.roll[index], model), 3),
            "pitch_deg": round(_number(aircraft.pitch[index], model), 3),
            "yaw_rate_deg_s": round(_number(aircraft.yaw_rate[index], model), 3),
            "heading_error_deg": round(_number(aircraft.heading[index], model), 3),
            "altitude_error_m": round(_number(aircraft.altitude_error[index], model), 3),
            "estimated_cross_m": round(_number(aircraft.estimated_cross[index], model), 3),
        }
        for index in indexes
    ]


Interval = tuple[float, float]


def _iadd(*values: Interval) -> Interval:
    return sum(value[0] for value in values), sum(value[1] for value in values)


def _iscale(value: Interval, factor: float) -> Interval:
    candidates = value[0] * factor, value[1] * factor
    return min(candidates), max(candidates)


def _iclamp(value: Interval, low: float, high: float) -> Interval:
    return max(low, value[0]), min(high, value[1])


def _interval_bound(aircraft: SymbolicAircraft, key: str, seconds: int) -> Interval:
    magnitude = aircraft._scenario_radius_at(key, seconds)
    return -magnitude, magnitude


def _conservative_envelope(aircraft: SymbolicAircraft) -> list[dict[str, float]]:
    """Fallback interval over-approximation used for diagnostic comparison."""

    along: Interval = (0.0, 0.0)
    cross: Interval = (0.0, 0.0)
    heading: Interval = (0.0, 0.0)
    roll: Interval = (0.0, 0.0)
    pitch: Interval = (0.0, 0.0)
    altitude: Interval = (0.0, 0.0)
    samples = []
    stride = max(1, aircraft.steps // 12)

    for index in range(aircraft.steps + 1):
        if index % stride == 0 or index == aircraft.steps:
            samples.append(
                {
                    "seconds": index * aircraft.step_seconds,
                    "along_min_m": round(along[0], 3),
                    "along_max_m": round(along[1], 3),
                    "cross_min_m": round(cross[0], 3),
                    "cross_max_m": round(cross[1], 3),
                }
            )
        if index == aircraft.steps:
            break

        seconds = index * aircraft.step_seconds
        gps = _interval_bound(aircraft, "gps_bias_m", seconds)
        nav_output = _interval_bound(aircraft, "nav_output_bias_m", seconds)
        route = _interval_bound(aircraft, "route_offset_m", seconds)
        roll_attack = _interval_bound(aircraft, "roll_injection_deg", seconds)
        pitch_attack = _interval_bound(aircraft, "pitch_error_deg", seconds)
        dropout = _interval_bound(aircraft, "fms_steering_dropout", seconds)
        nav_loss = _interval_bound(aircraft, "navigation_loss", seconds)
        stale_roll = _interval_bound(aircraft, "stale_roll_bound_deg", seconds)
        stale_pitch = _interval_bound(aircraft, "stale_pitch_bound_deg", seconds)
        altitude_offset_ft = _interval_bound(
            aircraft, "mcdu_altitude_offset_ft", seconds
        )
        wind = _interval_bound(aircraft, "crosswind_mps", seconds)
        gust = _interval_bound(aircraft, "vertical_gust_mps", seconds)

        if aircraft.profile == "secure":
            estimate = _iadd(cross, (-60.0, 60.0))
            desired = (0.0, 0.0)
        else:
            estimate = _iadd(cross, gps, nav_output)
            desired = route
        error = _iadd(estimate, _iscale(desired, -1.0))
        fms = _iclamp(_iscale(error, -0.012), -32.0, 32.0)

        if aircraft.profile == "secure":
            command = _iclamp(fms, -32.0, 32.0)
            pitch_command = _iclamp(_iscale(altitude, -0.018), -18.0, 18.0)
        else:
            command = (
                min(fms[0], roll_attack[0], stale_roll[0]),
                max(fms[1], roll_attack[1], stale_roll[1]),
            )
            command = _iclamp(command, -55.0, 55.0)
            desired_altitude_m = _iscale(altitude_offset_ft, 0.3048)
            altitude_command_error = _iadd(altitude, _iscale(desired_altitude_m, -1.0))
            pitch_command = _iclamp(
                _iadd(_iscale(altitude_command_error, -0.018), pitch_attack),
                -28.0,
                28.0,
            )
            if dropout != (0.0, 0.0) or nav_loss != (0.0, 0.0):
                pitch_command = (
                    min(pitch_command[0], stale_pitch[0]),
                    max(pitch_command[1], stale_pitch[1]),
                )
        response = 0.42

        roll = _iadd(_iscale(roll, 1.0 - response), _iscale(command, response))
        pitch = _iadd(
            _iscale(pitch, 1.0 - response), _iscale(pitch_command, response)
        )
        yaw = _iscale(roll, 0.045)
        heading = _iadd(heading, _iscale(yaw, aircraft.step_seconds))
        lateral = _iadd(_iscale(heading, 2.356), wind)
        vertical = _iadd(_iscale(pitch, 2.356), gust)
        cross = _iadd(cross, _iscale(lateral, aircraft.step_seconds))
        altitude = _iadd(altitude, _iscale(vertical, aircraft.step_seconds))
        maximum_heading = min(89.0, max(abs(heading[0]), abs(heading[1])))
        minimum_tangent_speed = max(
            0.0, 135.0 * math.cos(math.radians(maximum_heading)) - 8.0
        )
        along = _iadd(along, (
            minimum_tangent_speed * aircraft.step_seconds,
            143.0 * aircraft.step_seconds,
        ))
    return samples


@dataclass
class _Zonotope:
    center: list[float]
    generators: list[list[float]]

    @classmethod
    def zero(cls, dimensions: int) -> "_Zonotope":
        return cls([0.0] * dimensions, [])

    def transform(self, matrix: list[list[float]]) -> "_Zonotope":
        def multiply(vector: list[float]) -> list[float]:
            return [
                sum(coefficient * vector[column] for column, coefficient in enumerate(row))
                for row in matrix
            ]

        return _Zonotope(multiply(self.center), [multiply(item) for item in self.generators])

    def add_box(self, vector: list[float], magnitude: float) -> None:
        if magnitude:
            self.generators.append([coefficient * magnitude for coefficient in vector])

    def bounds(self) -> list[Interval]:
        result = []
        for index, center in enumerate(self.center):
            radius = sum(abs(item[index]) for item in self.generators)
            result.append((center - radius, center + radius))
        return result


def _zonotope_envelope(aircraft: SymbolicAircraft) -> list[dict[str, float]]:
    """Linear zonotope reach tube that retains cross-state correlations.

    Saturation is conservatively abstracted by the declared physical bank
    bounds.  Independent bounded disturbances add one generator per step, so
    every bounded input sequence is represented without sampling.
    """

    dt = float(aircraft.step_seconds)
    turn_gain = 0.045
    lateral_gain = 2.356
    nav_gain = 0.012
    response = 0.42
    decay = 1.0 - response

    roll_row = [-response * nav_gain, 0.0, decay]
    heading_row = [dt * turn_gain * roll_row[0], 1.0, dt * turn_gain * decay]
    cross_row = [
        1.0 + dt * lateral_gain * heading_row[0],
        dt * lateral_gain,
        dt * lateral_gain * heading_row[2],
    ]
    lateral_matrix = [cross_row, heading_row, roll_row]
    command_vector = [
        dt * lateral_gain * dt * turn_gain * response,
        dt * turn_gain * response,
        response,
    ]
    wind_vector = [dt, 0.0, 0.0]

    pitch_gain = 0.018
    pitch_decay = decay
    vertical_matrix = [
        [1.0 - dt * lateral_gain * response * pitch_gain, dt * lateral_gain * pitch_decay],
        [-response * pitch_gain, pitch_decay],
    ]
    pitch_vector = [dt * lateral_gain * response, response]
    gust_vector = [dt, 0.0]

    lateral = _Zonotope.zero(3)  # cross-track, heading error, roll
    vertical = _Zonotope.zero(2)  # altitude error, pitch
    along: Interval = (0.0, 0.0)
    samples: list[dict[str, float]] = []
    direct_roll_capable = aircraft.profile == "vulnerable" and any(
        abs(float(attack.magnitude.get("roll_injection_deg", 0.0))) > 0
        for attack in aircraft.attacks
    )

    for index in range(aircraft.steps + 1):
        lateral_bounds = lateral.bounds()
        vertical_bounds = vertical.bounds()
        cross, heading, roll = lateral_bounds
        altitude, pitch = vertical_bounds
        bank_limit = 55.0 if direct_roll_capable else 32.0
        roll = _iclamp(roll, -bank_limit, bank_limit)
        pitch_limit = 18.0 if aircraft.profile == "secure" else 28.0
        pitch = _iclamp(pitch, -pitch_limit, pitch_limit)
        yaw = _iscale(roll, turn_gain)
        # Keep every proof step. Sub-sampling here previously hid an AFDX
        # over-bank between two displayed samples.
        samples.append(
            {
                "seconds": index * aircraft.step_seconds,
                "along_min_m": round(along[0], 3),
                "along_max_m": round(along[1], 3),
                "cross_min_m": round(cross[0], 3),
                "cross_max_m": round(cross[1], 3),
                "heading_min_deg": round(heading[0], 3),
                "heading_max_deg": round(heading[1], 3),
                "roll_min_deg": round(roll[0], 3),
                "roll_max_deg": round(roll[1], 3),
                "pitch_min_deg": round(pitch[0], 3),
                "pitch_max_deg": round(pitch[1], 3),
                "yaw_rate_min_deg_s": round(yaw[0], 3),
                "yaw_rate_max_deg_s": round(yaw[1], 3),
                "altitude_min_m": round(altitude[0], 3),
                "altitude_max_m": round(altitude[1], 3),
            }
        )
        if index == aircraft.steps:
            break

        seconds = index * aircraft.step_seconds
        gps = max(abs(value) for value in _interval_bound(aircraft, "gps_bias_m", seconds))
        nav_output = max(
            abs(value) for value in _interval_bound(aircraft, "nav_output_bias_m", seconds)
        )
        route = max(abs(value) for value in _interval_bound(aircraft, "route_offset_m", seconds))
        roll_injection = max(
            abs(value) for value in _interval_bound(aircraft, "roll_injection_deg", seconds)
        )
        wind = max(abs(value) for value in _interval_bound(aircraft, "crosswind_mps", seconds))
        pitch_injection = max(
            abs(value) for value in _interval_bound(aircraft, "pitch_error_deg", seconds)
        )
        stale_roll = max(
            abs(value) for value in _interval_bound(aircraft, "stale_roll_bound_deg", seconds)
        )
        stale_pitch = max(
            abs(value) for value in _interval_bound(aircraft, "stale_pitch_bound_deg", seconds)
        )
        altitude_offset_ft = max(
            abs(value) for value in _interval_bound(aircraft, "mcdu_altitude_offset_ft", seconds)
        )
        gust = max(abs(value) for value in _interval_bound(aircraft, "vertical_gust_mps", seconds))

        cross_radius = max(abs(cross[0]), abs(cross[1]))
        if aircraft.profile == "secure":
            measurement_radius = 40.0
        else:
            measurement_radius = gps + nav_output + route
        raw_command_radius = nav_gain * (cross_radius + measurement_radius)
        normal_command_limit = 32.0

        lateral = lateral.transform(lateral_matrix)
        command_uncertainty = nav_gain * measurement_radius
        lateral.add_box(command_vector, command_uncertainty)
        # sat(u) = u + e with |e| <= max(0, |u|max - limit). Keeping this
        # residual makes the linear tube a superset when feedback saturates.
        lateral.add_box(
            command_vector,
            max(0.0, raw_command_radius - normal_command_limit),
        )
        if aircraft.profile == "vulnerable":
            # Direct/stale modes replace rather than add to nominal feedback.
            # The extra raw-command radius can cancel that nominal term, so
            # both the baseline and every replacement branch are enclosed.
            replacement_radius = roll_injection + stale_roll
            if replacement_radius:
                lateral.add_box(
                    command_vector,
                    replacement_radius + raw_command_radius,
                )
        lateral.add_box(wind_vector, wind)

        altitude_radius = max(abs(altitude[0]), abs(altitude[1]))
        pitch_input_radius = pitch_injection + pitch_gain * 0.3048 * altitude_offset_ft
        raw_pitch_radius = pitch_gain * altitude_radius + pitch_input_radius
        vertical = vertical.transform(vertical_matrix)
        if aircraft.profile == "vulnerable":
            vertical.add_box(pitch_vector, pitch_injection)
            vertical.add_box(pitch_vector, 0.018 * 0.3048 * altitude_offset_ft)
            vertical.add_box(
                pitch_vector,
                max(0.0, raw_pitch_radius - 28.0),
            )
            if stale_pitch:
                vertical.add_box(
                    pitch_vector,
                    stale_pitch + raw_pitch_radius,
                )
        else:
            vertical.add_box(
                pitch_vector,
                max(0.0, raw_pitch_radius - 18.0),
            )
        vertical.add_box(gust_vector, gust)
        maximum_heading = min(89.0, max(abs(heading[0]), abs(heading[1])))
        minimum_tangent_speed = max(
            0.0, 135.0 * math.cos(math.radians(maximum_heading)) - 8.0
        )
        along = _iadd(along, (minimum_tangent_speed * dt, 143.0 * dt))

    return samples


def _active_value(aircraft: SymbolicAircraft, key: str, seconds: int) -> float:
    return aircraft._scenario_magnitude_at(key, seconds)


def _numeric_witness(aircraft: SymbolicAircraft, direction: int) -> list[dict[str, float]]:
    """Replay one deterministic, component-faithful boundary input sequence."""

    along = cross = heading = roll = pitch = altitude = estimated = 0.0
    dt = float(aircraft.step_seconds)
    response = 0.42
    trace: list[dict[str, float]] = []

    for index in range(aircraft.steps + 1):
        seconds = index * aircraft.step_seconds
        trace.append(
            {
                "seconds": seconds,
                "along_m": round(along, 3),
                "cross_m": round(cross, 3),
                "roll_deg": round(roll, 3),
                "pitch_deg": round(pitch, 3),
                "yaw_rate_deg_s": round(0.045 * roll, 3),
                "heading_error_deg": round(heading, 3),
                "altitude_error_m": round(altitude, 3),
                "estimated_cross_m": round(estimated, 3),
            }
        )
        if index == aircraft.steps:
            break

        gps_mag = aircraft._scenario_magnitude_at("gps_bias_m", seconds)
        _, gps_activation = aircraft._scenario_bound("gps_bias_m")
        gps_rate, _ = aircraft._scenario_bound("gps_bias_rate_mps")
        if gps_mag and seconds >= gps_activation:
            if gps_rate:
                gps_mag = min(
                    gps_mag,
                    gps_rate * (seconds - gps_activation + aircraft.step_seconds),
                )
            gps = -direction * gps_mag
        else:
            gps = 0.0
        route = direction * _active_value(aircraft, "route_offset_m", seconds)
        nav_output = direction * _active_value(
            aircraft, "nav_output_bias_m", seconds
        )
        injected_roll = direction * _active_value(
            aircraft, "roll_injection_deg", seconds
        )
        injected_pitch = direction * _active_value(
            aircraft, "pitch_error_deg", seconds
        )
        dropout = direction * _active_value(
            aircraft, "fms_steering_dropout", seconds
        )
        navigation_loss = direction * _active_value(
            aircraft, "navigation_loss", seconds
        )
        stale_roll = direction * _active_value(
            aircraft, "stale_roll_bound_deg", seconds
        )
        stale_pitch = direction * _active_value(
            aircraft, "stale_pitch_bound_deg", seconds
        )
        altitude_offset_ft = direction * _active_value(
            aircraft, "mcdu_altitude_offset_ft", seconds
        )
        wind = direction * _active_value(aircraft, "crosswind_mps", seconds)
        gust = direction * _active_value(aircraft, "vertical_gust_mps", seconds)

        if aircraft.profile == "secure":
            estimated = cross
            desired = 0.0
            roll_command = max(-32.0, min(32.0, -0.012 * (estimated - desired)))
            pitch_command = max(-18.0, min(18.0, -0.018 * altitude))
        else:
            estimated = cross + gps + nav_output
            desired = route
            fms_command = max(-32.0, min(32.0, -0.012 * (estimated - desired)))
            if injected_roll:
                roll_command = injected_roll
            elif dropout or navigation_loss:
                roll_command = stale_roll
            else:
                roll_command = fms_command
            roll_command = max(-55.0, min(55.0, roll_command))
            if dropout or navigation_loss:
                pitch_command = stale_pitch
            else:
                pitch_command = max(
                    -28.0,
                    min(
                        28.0,
                        -0.018 * (altitude - 0.3048 * altitude_offset_ft)
                        + injected_pitch,
                    ),
                )

        roll += response * (roll_command - roll)
        pitch += response * (pitch_command - pitch)
        yaw_rate = 0.045 * roll
        heading += yaw_rate * dt
        cross += (2.356 * heading + wind) * dt
        tangent_speed = 135.0 * math.cos(
            math.radians(max(-89.0, min(89.0, heading)))
        )
        along += max(0.0, tangent_speed) * dt
        altitude += (2.356 * pitch + gust) * dt
    return trace


def _interval_property(
    envelope: list[dict[str, float]],
    negative_trace: list[dict[str, float]],
    positive_trace: list[dict[str, float]],
    *,
    minimum_key: str,
    maximum_key: str,
    witness_key: str,
    limit: float,
    unit: str,
) -> dict[str, Any]:
    # A concrete replay is authoritative evidence of unsafety even if a proof
    # abstraction is accidentally too narrow. This precedence prevents a
    # regression of the former AFDX false-safe result.
    for trace in (negative_trace, positive_trace):
        for sample in trace:
            if abs(sample[witness_key]) > limit:
                return {
                    "status": "witnessed",
                    "violated": True,
                    "witness_seconds": sample["seconds"],
                    "limit": limit,
                    "unit": unit,
                    "witness": sample[witness_key],
                    "solver": "Concrete boundary-input replay witnesses the violation",
                }
    maximum = max(
        max(abs(sample[minimum_key]), abs(sample[maximum_key])) for sample in envelope
    )
    if maximum <= limit + 1e-9:
        return {
            "status": "contained",
            "violated": False,
            "witness_seconds": None,
            "limit": limit,
            "unit": unit,
            "witness": None,
            "solver": "Full zonotope tube is inside the configured property",
        }
    return {
        "status": "overapprox",
        "violated": None,
        "witness_seconds": None,
        "limit": limit,
        "unit": unit,
        "witness": None,
        "solver": "Conservative tube intersects the limit; no boundary replay witness",
    }


def _functional_property(
    profile: str,
    *,
    activation_seconds: int,
    unit: str,
    safeguard: str,
    vulnerable_effect: str,
) -> dict[str, Any]:
    if profile == "secure":
        return {
            "status": "recovered",
            "violated": False,
            "witness_seconds": None,
            "limit": 1,
            "unit": unit,
            "witness": None,
            "solver": safeguard,
        }
    return {
        "status": "witnessed",
        "violated": True,
        "witness_seconds": activation_seconds,
        "limit": 1,
        "unit": unit,
        "witness": 0,
        "solver": vulnerable_effect,
    }


def _tube_replay_failure(
    envelope: list[dict[str, float]],
    traces: tuple[list[dict[str, float]], ...],
) -> tuple[int, float] | None:
    """Return the first replay state not enclosed by its proof-tube sample."""

    by_time = {sample["seconds"]: sample for sample in envelope}
    fields = (
        ("along_m", "along_min_m", "along_max_m"),
        ("cross_m", "cross_min_m", "cross_max_m"),
        ("heading_error_deg", "heading_min_deg", "heading_max_deg"),
        ("roll_deg", "roll_min_deg", "roll_max_deg"),
        ("pitch_deg", "pitch_min_deg", "pitch_max_deg"),
        ("yaw_rate_deg_s", "yaw_rate_min_deg_s", "yaw_rate_max_deg_s"),
        ("altitude_error_m", "altitude_min_m", "altitude_max_m"),
    )
    for trace in traces:
        for state in trace:
            bounds = by_time.get(state["seconds"])
            if bounds is None:
                return int(state["seconds"]), float("nan")
            for value_key, minimum_key, maximum_key in fields:
                value = state[value_key]
                if value < bounds[minimum_key] - 0.002 or value > bounds[maximum_key] + 0.002:
                    return int(state["seconds"]), value
    return None


def _profile_result(
    profile: str,
    attack_ids: tuple[str, ...],
    horizon_seconds: int,
    step_seconds: int,
    safety: dict[str, float],
) -> dict[str, Any]:
    aircraft = SymbolicAircraft(profile, horizon_seconds, step_seconds, attack_ids)
    positive = _numeric_witness(aircraft, 1)
    negative = _numeric_witness(aircraft, -1)
    envelope = _zonotope_envelope(aircraft)

    properties = {
        "roll": _interval_property(
            envelope,
            negative,
            positive,
            minimum_key="roll_min_deg",
            maximum_key="roll_max_deg",
            witness_key="roll_deg",
            limit=safety["max_roll_deg"],
            unit="deg",
        ),
        "pitch": _interval_property(
            envelope,
            negative,
            positive,
            minimum_key="pitch_min_deg",
            maximum_key="pitch_max_deg",
            witness_key="pitch_deg",
            limit=safety["max_pitch_deg"],
            unit="deg",
        ),
        "yaw_rate": _interval_property(
            envelope,
            negative,
            positive,
            minimum_key="yaw_rate_min_deg_s",
            maximum_key="yaw_rate_max_deg_s",
            witness_key="yaw_rate_deg_s",
            limit=safety["max_yaw_rate_deg_s"],
            unit="deg/s",
        ),
        "course_deviation": _interval_property(
            envelope,
            negative,
            positive,
            minimum_key="cross_min_m",
            maximum_key="cross_max_m",
            witness_key="cross_m",
            limit=safety["max_course_deviation_nm"] * 1852.0,
            unit="m",
        ),
        "altitude_deviation": _interval_property(
            envelope,
            negative,
            positive,
            minimum_key="altitude_min_m",
            maximum_key="altitude_max_m",
            witness_key="altitude_error_m",
            limit=safety["max_altitude_deviation_ft"] * 0.3048,
            unit="m",
        ),
    }
    selected = set(attack_ids)
    functional_specs = {
        "fms_steering_dos": (
            "fms_steering_freshness",
            "fresh updates",
            "Freshness timeout and monitored heading reversion contain the outage.",
            "The missing FMS update remains stale past the required freshness bound.",
        ),
        "total_nav_loss": (
            "navigation_reversion_integrity",
            "validated fallback modes",
            "NAV REJECT and monitored attitude/track reversion contain the source outage.",
            "Stale navigation state retains authority without a validated reversion.",
        ),
        "radio_altimeter_fault": (
            "radio_height_availability",
            "selected valid channels",
            "The dual-channel monitor selects valid radio altimeter 2.",
            "The single-channel baseline reports no selected valid radio height despite RA2.",
        ),
    }
    for attack_id, (key, unit, secure_note, vulnerable_note) in functional_specs.items():
        if attack_id not in selected:
            continue
        attack = attack_by_id(attack_id)
        properties[key] = _functional_property(
            profile,
            activation_seconds=int(_effect_value(
                attack, "analysis_activation_seconds", attack.activation_seconds
            )),
            unit=unit,
            safeguard=secure_note,
            vulnerable_effect=vulnerable_note,
        )

    tube_failure = _tube_replay_failure(envelope, (negative, positive))
    if tube_failure is not None:
        failure_seconds, failure_value = tube_failure
        properties["proof_tube_consistency"] = {
            "status": "invalid",
            "violated": None,
            "witness_seconds": failure_seconds,
            "limit": 0,
            "unit": "replay states outside tube",
            "witness": failure_value if math.isfinite(failure_value) else None,
            "solver": "A deterministic replay escaped the claimed enclosure; no bounded-safe conclusion is allowed.",
        }
    violated = [key for key, value in properties.items() if value["violated"] is True]
    unknown = [key for key, value in properties.items() if value["violated"] is None]
    return {
        "profile": profile,
        "classification": "unsafe" if violated else ("unknown" if unknown else "bounded-safe"),
        "violated_properties": violated,
        "unknown_properties": unknown,
        "properties": properties,
        "envelope": envelope,
        "envelope_semantics": (
            "Conservative zonotope enclosure with saturation and replacement-mode residuals; "
            "one sample is retained for every proof step"
        ),
        "witness_traces": {"negative": negative, "positive": positive},
        "model": {
            "dynamics": "linearized coordinated turn with bounded route-tangent progress",
            "navigation": "route-aided multi-source monitor" if profile == "secure" else "GNSS/post-fusion authority",
            "bank_guard_deg": 55 if profile == "vulnerable" and "afdx_injection" in attack_ids else 32,
            "time_steps": aircraft.steps,
            "constraint_count": len(aircraft.constraints),
            "reachability": "zonotope tube plus replayable boundary witnesses",
        },
    }


def compute_reachability(
    attack_ids: Iterable[str],
    safety: dict[str, float] | None = None,
    *,
    horizon_seconds: int = 180,
    step_seconds: int = 6,
) -> dict[str, Any]:
    selected = tuple(dict.fromkeys(attack_ids))
    limits = dict(SAFETY_DEFAULTS)
    if safety:
        for key in limits:
            if key in safety:
                limits[key] = float(safety[key])
    for item in selected:
        attack_by_id(item)

    return {
        "schema_version": "1.1",
        "status": "complete",
        "engine": "MCA component contracts + bounded zonotope transition system",
        "semantics": (
            "All states enclosed by the declared component contracts, independent "
            "external-input radii, branch residuals, time step, and finite horizon. "
            "Analysis time is scenario-relative: selected operating gates are assumed "
            "satisfied and their bounded effects begin at the published analysis injection."
        ),
        "not_in_scope": (
            "Unbounded time, full six-degree-of-freedom aerodynamics, bus timing, "
            "probability, automatic flight-phase evolution inside the reach model, "
            "certification, and operational navigation."
        ),
        "analysis_time_basis": "scenario-relative local flight condition",
        "gate_assumption": "Every selected phase/AGL/precondition gate is assumed satisfied at analysis injection.",
        "attack_ids": list(selected),
        "horizon_seconds": horizon_seconds,
        "step_seconds": step_seconds,
        "safety": limits,
        "profiles": {
            profile: _profile_result(
                profile, selected, horizon_seconds, step_seconds, limits
            )
            for profile in ("secure", "vulnerable")
        },
    }


# The inverse query deliberately uses the same symbolic transition system as
# the forward bounded analysis.  Values are expressed in the units used by the
# UI while the internal model keeps metres for position and altitude error.
_INVERSE_TARGETS: dict[str, tuple[str, float, float, float, float, str]] = {
    # public key: state series, unit scale, match tolerance, minimum, maximum, unit
    "roll_deg": ("roll", 1.0, 0.75, -55.0, 55.0, "deg"),
    "pitch_deg": ("pitch", 1.0, 0.75, -28.0, 28.0, "deg"),
    "yaw_rate_deg_s": ("yaw_rate", 1.0, 0.08, -2.5, 2.5, "deg/s"),
    "heading_error_deg": ("heading", 1.0, 1.0, -90.0, 90.0, "deg"),
    "course_deviation_nm": ("cross", 1852.0, 0.15, -80.0, 80.0, "NM"),
    "altitude_deviation_ft": (
        "altitude_error",
        0.3048,
        100.0,
        -12_000.0,
        8_000.0,
        "ft",
    ),
}

_INVERSE_INPUTS: dict[str, tuple[str, str, str]] = {
    # public key: SymbolicAircraft series, scenario magnitude key, unit
    "gnss_bias_m": ("gps_bias", "gps_bias_m", "m"),
    "radio_navigation_bias_m": ("radio_bias", "radio_bias_m", "m"),
    "post_fusion_bias_m": ("nav_output_bias", "nav_output_bias_m", "m"),
    "route_database_offset_m": ("route_offset", "route_offset_m", "m"),
    "direct_roll_command_deg": ("roll_injection", "roll_injection_deg", "deg"),
    "direct_pitch_error_deg": ("pitch_injection", "pitch_error_deg", "deg"),
    "fms_update_loss": ("fms_dropout", "fms_steering_dropout", "flag"),
    "navigation_source_loss": ("navigation_loss", "navigation_loss", "flag"),
    "stale_roll_command_deg": ("stale_roll_command", "stale_roll_bound_deg", "deg"),
    "stale_pitch_command_deg": ("stale_pitch_command", "stale_pitch_bound_deg", "deg"),
    "mcdu_altitude_offset_ft": ("mcdu_altitude_offset", "mcdu_altitude_offset_ft", "ft"),
    "crosswind_mps": ("crosswind", "crosswind_mps", "m/s"),
    "vertical_gust_mps": ("vertical_gust", "vertical_gust_mps", "m/s"),
}

_TARGET_INPUT_KEYS: dict[str, set[str]] = {
    "roll_deg": {
        "gps_bias_m", "radio_bias_m", "nav_output_bias_m", "route_offset_m",
        "roll_injection_deg", "fms_steering_dropout", "navigation_loss",
        "stale_roll_bound_deg", "crosswind_mps",
    },
    "pitch_deg": {
        "pitch_error_deg", "fms_steering_dropout", "navigation_loss",
        "stale_pitch_bound_deg", "mcdu_altitude_offset_ft", "vertical_gust_mps",
    },
    "yaw_rate_deg_s": {
        "gps_bias_m", "radio_bias_m", "nav_output_bias_m", "route_offset_m",
        "roll_injection_deg", "fms_steering_dropout", "navigation_loss",
        "stale_roll_bound_deg", "crosswind_mps",
    },
    "heading_error_deg": {
        "gps_bias_m", "radio_bias_m", "nav_output_bias_m", "route_offset_m",
        "roll_injection_deg", "fms_steering_dropout", "navigation_loss",
        "stale_roll_bound_deg", "crosswind_mps",
    },
    "course_deviation_nm": {
        "gps_bias_m", "radio_bias_m", "nav_output_bias_m", "route_offset_m",
        "roll_injection_deg", "fms_steering_dropout", "navigation_loss",
        "stale_roll_bound_deg", "crosswind_mps",
    },
    "altitude_deviation_ft": {
        "pitch_error_deg", "fms_steering_dropout", "navigation_loss",
        "stale_pitch_bound_deg", "mcdu_altitude_offset_ft", "vertical_gust_mps",
    },
}


def _validated_inverse_target(target: dict[str, Any]) -> dict[str, float]:
    if not isinstance(target, dict) or not target:
        raise ValueError("target must contain at least one aircraft-state field")
    unknown = sorted(set(target) - set(_INVERSE_TARGETS))
    if unknown:
        raise ValueError(f"Unknown inverse target field(s): {', '.join(unknown)}")
    result: dict[str, float] = {}
    for key, raw in target.items():
        if isinstance(raw, bool):
            raise ValueError(f"{key} must be numeric")
        value = float(raw)
        if not math.isfinite(value):
            raise ValueError(f"{key} must be finite")
        _, _, _, minimum, maximum, _ = _INVERSE_TARGETS[key]
        if value < minimum or value > maximum:
            raise ValueError(f"{key} must be between {minimum:g} and {maximum:g}")
        result[key] = value
    return result


def _inverse_target_formula(
    aircraft: SymbolicAircraft,
    target: dict[str, float],
) -> tuple[z3.BoolRef, list[list[z3.BoolRef]]]:
    per_step: list[list[z3.BoolRef]] = []
    # Index zero is the fixed nominal initial state.  A backward query asks
    # whether the target can be produced by at least one transition.
    for index in range(1, aircraft.steps + 1):
        clauses: list[z3.BoolRef] = []
        for key, requested in target.items():
            series_name, scale, tolerance, _, _, _ = _INVERSE_TARGETS[key]
            expression = getattr(aircraft, series_name)[index]
            internal_target = requested * scale
            internal_tolerance = tolerance * scale
            clauses.extend((
                expression >= _q(internal_target - internal_tolerance),
                expression <= _q(internal_target + internal_tolerance),
            ))
        per_step.append(clauses)
    return z3.Or(*(z3.And(*clauses) for clauses in per_step)), per_step


def _state_matches_target(
    aircraft: SymbolicAircraft,
    model: z3.ModelRef,
    index: int,
    target: dict[str, float],
) -> bool:
    for key, requested in target.items():
        series_name, scale, tolerance, _, _, _ = _INVERSE_TARGETS[key]
        actual = _number(getattr(aircraft, series_name)[index], model) / scale
        if abs(actual - requested) > tolerance + 1e-7:
            return False
    return True


def _inverse_state_snapshot(
    aircraft: SymbolicAircraft,
    model: z3.ModelRef,
    index: int,
) -> dict[str, float]:
    return {
        "roll_deg": round(_number(aircraft.roll[index], model), 3),
        "pitch_deg": round(_number(aircraft.pitch[index], model), 3),
        "yaw_rate_deg_s": round(_number(aircraft.yaw_rate[index], model), 3),
        "heading_error_deg": round(_number(aircraft.heading[index], model), 3),
        "course_deviation_nm": round(_number(aircraft.cross[index], model) / 1852.0, 4),
        "altitude_deviation_ft": round(_number(aircraft.altitude_error[index], model) / 0.3048, 1),
    }


def _inverse_witness_inputs(
    aircraft: SymbolicAircraft,
    model: z3.ModelRef,
    witness_index: int,
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for public_key, (series_name, magnitude_key, unit) in _INVERSE_INPUTS.items():
        series = getattr(aircraft, series_name)
        values = [
            (index, _number(series[index], model))
            for index in range(min(witness_index, len(series) - 1) + 1)
        ]
        if not values:
            continue
        peak_index, peak_value = max(values, key=lambda item: abs(item[1]))
        if abs(peak_value) <= 1e-7:
            continue
        scenario_ids = [
            attack.id for attack in aircraft.attacks
            if abs(float(attack.magnitude.get(magnitude_key, 0.0))) > 0
        ]
        result.append({
            "input": public_key,
            "magnitude_key": magnitude_key,
            "value": round(peak_value, 4),
            "unit": unit,
            "seconds": peak_index * aircraft.step_seconds,
            "scenario_ids": scenario_ids,
        })
    return sorted(result, key=lambda item: abs(float(item["value"])), reverse=True)


def _solve_inverse_target(
    profile: str,
    attack_ids: tuple[str, ...],
    target: dict[str, float],
    horizon_seconds: int,
    step_seconds: int,
) -> dict[str, Any]:
    aircraft = SymbolicAircraft(profile, horizon_seconds, step_seconds, attack_ids)
    _, per_step = _inverse_target_formula(aircraft, target)

    envelope_keys = {
        "roll_deg": ("roll_min_deg", "roll_max_deg"),
        "pitch_deg": ("pitch_min_deg", "pitch_max_deg"),
        "yaw_rate_deg_s": ("yaw_rate_min_deg_s", "yaw_rate_max_deg_s"),
        "heading_error_deg": ("heading_min_deg", "heading_max_deg"),
        "course_deviation_nm": ("cross_min_m", "cross_max_m"),
        "altitude_deviation_ft": ("altitude_min_m", "altitude_max_m"),
    }
    envelope = _zonotope_envelope(aircraft)
    candidates: list[tuple[float, int]] = []
    for index in range(1, aircraft.steps + 1):
        sample = envelope[index]
        score = 0.0
        possible = True
        for key, requested in target.items():
            _, scale, tolerance, _, _, _ = _INVERSE_TARGETS[key]
            lower_key, upper_key = envelope_keys[key]
            lower = float(sample[lower_key])
            upper = float(sample[upper_key])
            target_low = (requested - tolerance) * scale
            target_high = (requested + tolerance) * scale
            if target_high < lower or target_low > upper:
                possible = False
                break
            centre = (lower + upper) / 2.0
            score += abs(requested * scale - centre) / max(1.0, upper - lower)
        if possible:
            candidates.append((score, index))

    if not candidates:
        return {
            "status": "unsat",
            "reachable": False,
            "witness_seconds": None,
            "reached_state": None,
            "witness_inputs": [],
            "solver": "Target excluded by the conservative reach enclosure",
            "constraint_count": len(aircraft.constraints) + 1,
        }

    # The conservative enclosure first removes impossible proof steps.  Exact
    # Z3 checks are then performed one step at a time, ordered by closeness to
    # the requested state.  This avoids a large cross-time disjunction while
    # preserving the exact same-time conjunction for multi-field targets.
    unknown_reasons: list[str] = []
    for _, witness_index in sorted(candidates):
        # Equality elimination makes the backward query substantially faster
        # than the generic forward diagnostic solver while preserving the same
        # QF_LRA constraints and a reconstructable witness model.
        solver = z3.Then(
            "simplify", "propagate-ineqs", "solve-eqs", "smt"
        ).solver()
        solver.set(timeout=4_000)
        solver.add(*aircraft.constraints)
        # Produce an attributable attack/environment witness instead of
        # silently spending the always-present INS/radio/along-track nuisance
        # uncertainty.  Those uncertainties remain covered by the forward
        # reach tube; the inverse explanation intentionally holds them nominal.
        solver.add(*(
            value == 0
            for series in (aircraft.ins_error, aircraft.radio_error, aircraft.along_wind)
            for value in series
        ))
        solver.add(z3.And(*per_step[witness_index - 1]))
        outcome = solver.check()
        if outcome == z3.sat:
            model = solver.model()
            result = {
                "status": "sat",
                "reachable": True,
                "witness_seconds": witness_index * aircraft.step_seconds,
                "reached_state": _inverse_state_snapshot(aircraft, model, witness_index),
                "witness_inputs": _inverse_witness_inputs(aircraft, model, witness_index),
                "solver": "Z3 SAT target-state witness",
                "constraint_count": len(aircraft.constraints) + 1,
            }
            return result
        if outcome == z3.unknown:
            unknown_reasons.append(solver.reason_unknown())

    if unknown_reasons:
        return {
            "status": "unknown",
            "reachable": None,
            "witness_seconds": None,
            "reached_state": None,
            "witness_inputs": [],
            "solver": f"Z3 unknown after enclosure filtering: {unknown_reasons[0]}",
            "constraint_count": len(aircraft.constraints) + 1,
        }
    return {
        "status": "unsat",
        "reachable": False,
        "witness_seconds": None,
        "reached_state": None,
        "witness_inputs": [],
        "solver": "Z3 UNSAT at every enclosure-compatible proof step",
        "constraint_count": len(aircraft.constraints) + 1,
    }


def _scenario_relevant_to_target(attack: Any, target: dict[str, float]) -> bool:
    relevant = set().union(*(_TARGET_INPUT_KEYS[key] for key in target))
    return any(abs(float(value)) > 0 and key in relevant for key, value in attack.magnitude.items())


def _blocking_evidence(profile: str, attacks: Iterable[Any]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for attack in attacks:
        native = set(attack.evidence.native_components)
        for step in attack.steps:
            status = step.secure_status if profile == "secure" else step.vulnerable_status
            if status != "blocked":
                continue
            key = attack.id, step.component
            if key in seen:
                continue
            seen.add(key)
            result.append({
                "scenario_id": attack.id,
                "scenario_title": attack.title,
                "component_id": step.component,
                "decision": step.label,
                "evidence": "native" if step.component in native else attack.evidence.coverage,
                "message_types": list(attack.evidence.message_types),
            })
    return result


def compute_inverse_reachability(
    target: dict[str, Any],
    attack_ids: Iterable[str] | None = None,
    *,
    horizon_seconds: int = 120,
    step_seconds: int = 6,
) -> dict[str, Any]:
    """Solve backward from a requested aircraft state to admissible inputs.

    This is an exact satisfiability query over the bounded symbolic plant.  It
    composes the same scenario contracts used by forward reachability, but it
    does not claim that angr itself models continuous aircraft dynamics.
    """

    requested = _validated_inverse_target(target)
    selected = tuple(dict.fromkeys(
        attack.id for attack in ATTACK_SCENARIOS
    )) if attack_ids is None else tuple(dict.fromkeys(attack_ids))
    attacks = tuple(attack_by_id(item) for item in selected)
    relevant_attacks = tuple(
        attack for attack in attacks if _scenario_relevant_to_target(attack, requested)
    )
    relevant_ids = tuple(attack.id for attack in relevant_attacks)

    profiles: dict[str, Any] = {}
    for profile in ("secure", "vulnerable"):
        individual: list[dict[str, Any]] = []
        individual_results: list[tuple[Any, dict[str, Any]]] = []
        for attack in relevant_attacks:
            result = _solve_inverse_target(
                profile, (attack.id,), requested, horizon_seconds, step_seconds
            )
            individual_results.append((attack, result))
            if result["reachable"] is True:
                individual.append({
                    "id": attack.id,
                    "title": attack.title,
                    "evidence": attack.evidence.coverage,
                    "native_components": list(attack.evidence.native_components),
                    "message_types": list(attack.evidence.message_types),
                    "witness_seconds": result["witness_seconds"],
                })

        feasible = next(
            (result for _, result in individual_results if result["reachable"] is True),
            None,
        )
        if feasible is not None:
            combined = dict(feasible)
            combination_required = False
        elif len(relevant_ids) > 1:
            # Only pay for the larger composed query if no single scenario can
            # reach the state; this is the case where a combination matters.
            combined = _solve_inverse_target(
                profile, relevant_ids, requested, horizon_seconds, step_seconds
            )
            combination_required = combined["reachable"] is True
        elif individual_results:
            combined = dict(individual_results[0][1])
            combination_required = False
        else:
            combined = _solve_inverse_target(
                profile, (), requested, horizon_seconds, step_seconds
            )
            combination_required = False

        combined.update({
            "individually_enabling_scenarios": individual,
            "combination_required": combination_required,
            "blocking_evidence": _blocking_evidence(profile, relevant_attacks),
        })
        profiles[profile] = combined

    return {
        "schema_version": "1.0",
        "status": "complete",
        "engine": "exact Z3 backward target query over MCA contracts and bounded plant dynamics",
        "semantics": (
            "SAT means one admissible bounded input sequence reaches every selected target field "
            "at the same proof step. UNSAT is limited to the declared scenarios, bounds, time step, and horizon."
        ),
        "evidence_boundary": (
            "angr/MCA establishes native component-message feasibility; the coordinated-turn plant "
            "and environmental effects are explicit demonstrator assumptions."
        ),
        "target": requested,
        "target_tolerances": {
            key: {"value": _INVERSE_TARGETS[key][2], "unit": _INVERSE_TARGETS[key][5]}
            for key in requested
        },
        "attack_ids": list(selected),
        "relevant_attack_ids": list(relevant_ids),
        "horizon_seconds": horizon_seconds,
        "step_seconds": step_seconds,
        "profiles": profiles,
    }
