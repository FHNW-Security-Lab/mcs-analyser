from __future__ import annotations

import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BIN = ROOT / "bin" / "aviation"

MSG_GNSS_POSITION = 0xA101
MSG_INS_POSITION = 0xA111
MSG_RADIO_POSITION = 0xA121
MSG_NAV_SOLUTION = 0xA201
MSG_NAV_REJECT = 0xA202
MSG_NAV_DEGRADED_SOLUTION = 0xA203
MSG_DLS_ROUTE_LOAD = 0xA171
MSG_ROUTE_ACTIVE = 0xA172
MSG_ROUTE_REJECT = 0xA173
MSG_UNTRUSTED_GUIDANCE = 0xA182
MSG_INGRESS_REJECT = 0xA183
MSG_RA1_HEIGHT = 0xA191
MSG_RA1_INVALID = 0xA192
MSG_RA2_HEIGHT = 0xA193
MSG_RADIO_HEIGHT = 0xA195
MSG_RADIO_HEIGHT_UNAVAILABLE = 0xA196
MSG_FLIGHT_GUIDANCE = 0xA311
MSG_ENVELOPE_COMMAND = 0xA401
MSG_ENVELOPE_ALERT = 0xA402
MSG_ACTUATOR_COMMAND = 0xA501
MSG_UNSAFE_STATE = 0xA603
MODE_NAV_DIRECT = 0x0001


def pack_position(latitude_e6: int, longitude_e6: int) -> int:
    return ((latitude_e6 & 0xFFFFFFFF) << 32) | (longitude_e6 & 0xFFFFFFFF)


def pack_attitude(pitch_cdeg: int, roll_cdeg: int, yaw_cdeg: int, flags: int) -> int:
    return (
        ((pitch_cdeg & 0xFFFF) << 48)
        | ((roll_cdeg & 0xFFFF) << 32)
        | ((yaw_cdeg & 0xFFFF) << 16)
        | (flags & 0xFFFF)
    )


def decode_line(line: str, expected_message_id: int) -> int:
    fields = line.split()
    if len(fields) == 2:
        actual_message_id, payload = map(int, fields)
        if actual_message_id != expected_message_id:
            raise AssertionError(
                f"Expected message {expected_message_id}, got {actual_message_id}"
            )
        return payload
    prefix = str(expected_message_id)
    if not line.startswith(prefix):
        raise AssertionError(f"Expected message {expected_message_id}, got {line!r}")
    return int(line[len(prefix) :])


def run_component(profile: str, component: str, frames: list[tuple[int, int]]) -> list[str]:
    data = "".join(f"{message_id} {payload}\n" for message_id, payload in frames)
    completed = subprocess.run(
        [str(BIN / profile / component)],
        input=data,
        text=True,
        capture_output=True,
        check=True,
        timeout=5,
    )
    return [line for line in completed.stdout.splitlines() if line]


class NativeComponentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        subprocess.run(
            ["make", "-C", str(BIN), "all"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True,
            timeout=30,
        )

    def test_secure_voter_rejects_lone_gnss_bias_and_prefers_ins(self):
        reference = pack_position(52_520_008, 13_404_954)
        spoofed = pack_position(52_570_008, 13_454_954)
        output = run_component(
            "secure",
            "c07_navigation_fusion",
            [
                (MSG_GNSS_POSITION, spoofed),
                (MSG_INS_POSITION, reference),
                (MSG_RADIO_POSITION, reference),
            ],
        )
        self.assertEqual(len(output), 1)
        # The secure voter rejects the outlier, preserves the independently
        # corroborated INS solution, and marks the result as degraded.
        self.assertEqual(
            decode_line(output[0], MSG_NAV_DEGRADED_SOLUTION), reference
        )

    def test_secure_voter_emits_nominal_solution_when_sources_agree(self):
        reference = pack_position(52_520_008, 13_404_954)
        output = run_component(
            "secure",
            "c07_navigation_fusion",
            [
                (MSG_GNSS_POSITION, reference),
                (MSG_INS_POSITION, reference),
                (MSG_RADIO_POSITION, reference),
            ],
        )
        self.assertEqual(len(output), 1)
        self.assertEqual(decode_line(output[0], MSG_NAV_SOLUTION), reference)

    def test_vulnerable_voter_grants_gnss_authority(self):
        spoofed = pack_position(52_570_008, 13_454_954)
        output = run_component(
            "vulnerable",
            "c07_navigation_fusion",
            [(MSG_GNSS_POSITION, spoofed)],
        )
        self.assertEqual(decode_line(output[0], MSG_NAV_SOLUTION), spoofed)

    def test_secure_envelope_always_clamps_direct_mode(self):
        requested = pack_attitude(0, 7_000, 18_000, MODE_NAV_DIRECT)
        output = run_component(
            "secure",
            "c10_envelope_protection",
            [(MSG_FLIGHT_GUIDANCE, requested)],
        )
        self.assertEqual(len(output), 2)
        decode_line(output[0], MSG_ENVELOPE_ALERT)
        protected = decode_line(output[1], MSG_ENVELOPE_COMMAND)
        protected_roll = (protected >> 32) & 0xFFFF
        if protected_roll & 0x8000:
            protected_roll -= 0x10000
        self.assertEqual(protected_roll, 3_200)

    def test_vulnerable_direct_mode_reaches_unsafe_aircraft_sink(self):
        requested = pack_attitude(0, 7_000, 18_000, MODE_NAV_DIRECT)
        envelope_output = run_component(
            "vulnerable",
            "c10_envelope_protection",
            [(MSG_FLIGHT_GUIDANCE, requested)],
        )
        propagated = decode_line(envelope_output[-1], MSG_ENVELOPE_COMMAND)
        self.assertEqual(propagated, requested)

        effect_output = run_component(
            "vulnerable",
            "c12_aircraft_effect",
            [(MSG_ACTUATOR_COMMAND, propagated)],
        )
        self.assertEqual(decode_line(effect_output[0], MSG_UNSAFE_STATE), requested)

    def test_route_load_guard_rejects_modified_leg_only_on_secure_profile(self):
        modified_leg = pack_position(52_520_008, 13_464_954)
        secure = run_component(
            "secure", "c15_route_integrity", [(MSG_DLS_ROUTE_LOAD, modified_leg)]
        )
        vulnerable = run_component(
            "vulnerable", "c15_route_integrity", [(MSG_DLS_ROUTE_LOAD, modified_leg)]
        )
        decode_line(secure[0], MSG_ROUTE_REJECT)
        self.assertEqual(decode_line(vulnerable[0], MSG_ROUTE_ACTIVE), modified_leg)

    def test_afdx_ingress_guard_rejects_untrusted_publisher_only_on_secure_profile(self):
        forged = pack_attitude(0, 4_800, 18_000, MODE_NAV_DIRECT)
        secure = run_component(
            "secure", "c17_afdx_ingress_guard", [(MSG_UNTRUSTED_GUIDANCE, forged)]
        )
        vulnerable = run_component(
            "vulnerable", "c17_afdx_ingress_guard", [(MSG_UNTRUSTED_GUIDANCE, forged)]
        )
        decode_line(secure[0], MSG_INGRESS_REJECT)
        self.assertEqual(decode_line(vulnerable[0], MSG_FLIGHT_GUIDANCE), forged)

    def test_secure_radio_height_monitor_reverts_to_second_channel(self):
        secure = run_component(
            "secure",
            "c20_radio_height_monitor",
            [(MSG_RA1_INVALID, 0x1801), (MSG_RA2_HEIGHT, 450)],
        )
        vulnerable = run_component(
            "vulnerable",
            "c20_radio_height_monitor",
            [(MSG_RA1_INVALID, 0x1801)],
        )
        self.assertEqual(decode_line(secure[0], MSG_RADIO_HEIGHT), 450)
        decode_line(vulnerable[0], MSG_RADIO_HEIGHT_UNAVAILABLE)


if __name__ == "__main__":
    unittest.main()
