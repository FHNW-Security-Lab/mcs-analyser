from __future__ import annotations

import math
import unittest

from aviation_demo.model import ATTACK_SCENARIOS, public_config
from aviation_demo.reachability import (
    SymbolicAircraft,
    compute_inverse_reachability,
    compute_reachability,
)
from aviation_demo.server import app


class ReachabilityTests(unittest.TestCase):
    def test_public_ids_are_unique(self):
        config = public_config()
        route_ids = [item["id"] for item in config["routes"]]
        attack_ids = [item["id"] for item in config["attacks"]]
        self.assertEqual(len(route_ids), len(set(route_ids)))
        self.assertEqual(len(attack_ids), len(set(attack_ids)))
        self.assertEqual(len(attack_ids), 11)
        required = {
            "signal_property",
            "attack_surface",
            "preconditions",
            "operating_window",
            "detection",
            "hazard",
            "effect",
            "evidence",
        }
        for attack in config["attacks"]:
            self.assertTrue(required.issubset(attack), attack["id"])
            step_ids = {step["id"] for step in attack["steps"]}
            for step in attack["steps"]:
                self.assertTrue(set(step["depends_on"]).issubset(step_ids))

    def test_secure_profile_contains_every_built_in_scenario(self):
        for attack in ATTACK_SCENARIOS:
            with self.subTest(attack=attack.id):
                result = compute_reachability([attack.id])
                secure = result["profiles"]["secure"]
                self.assertEqual(secure["classification"], "bounded-safe")
                self.assertFalse(secure["violated_properties"])
                for profile in result["profiles"].values():
                    self.assertNotIn("proof_tube_consistency", profile["properties"])

    def test_gnss_spoof_has_replayable_vulnerable_diversion(self):
        result = compute_reachability(["gnss_spoof"])
        vulnerable = result["profiles"]["vulnerable"]
        course = vulnerable["properties"]["course_deviation"]
        self.assertEqual(vulnerable["classification"], "unsafe")
        self.assertTrue(course["violated"])
        self.assertEqual(course["status"], "witnessed")
        self.assertGreater(abs(course["witness"]), 1852.0)

    def test_attack_effects_reach_expected_properties(self):
        expectations = {
            "gnss_degraded_mode": "course_deviation",
            "coherent_nav_spoof": "course_deviation",
            "efb_map_tamper": "course_deviation",
            "afdx_injection": "roll",
            "nav_output_tamper": "course_deviation",
            "fms_steering_dos": "course_deviation",
            "total_nav_loss": "course_deviation",
            "mcdu_altitude_tamper": "altitude_deviation",
        }
        for attack_id, property_name in expectations.items():
            with self.subTest(attack=attack_id):
                result = compute_reachability([attack_id])
                property_result = result["profiles"]["vulnerable"]["properties"][
                    property_name
                ]
                self.assertTrue(property_result["violated"])
                self.assertIsNotNone(property_result["witness_seconds"])

    def test_availability_hazards_are_explicit_without_fabricated_kinematics(self):
        radio = compute_reachability(["radio_altimeter_fault"])
        secure = radio["profiles"]["secure"]
        vulnerable = radio["profiles"]["vulnerable"]
        self.assertFalse(secure["properties"]["radio_height_availability"]["violated"])
        self.assertTrue(vulnerable["properties"]["radio_height_availability"]["violated"])
        for property_name in ("roll", "pitch", "course_deviation", "altitude_deviation"):
            self.assertFalse(vulnerable["properties"][property_name]["violated"])

        fms = compute_reachability(["fms_steering_dos"])["profiles"]["vulnerable"]
        nav = compute_reachability(["total_nav_loss"])["profiles"]["vulnerable"]
        self.assertTrue(fms["properties"]["fms_steering_freshness"]["violated"])
        self.assertTrue(nav["properties"]["navigation_reversion_integrity"]["violated"])

    def test_every_scenario_is_exercised_in_the_default_local_analysis_window(self):
        finite = {
            "afdx_injection",
            "fms_steering_dos",
            "total_nav_loss",
            "convective_gust",
        }
        for attack in ATTACK_SCENARIOS:
            with self.subTest(attack=attack.id):
                aircraft = SymbolicAircraft("vulnerable", 180, 6, (attack.id,))
                used_keys = [key for key, value in attack.magnitude.items() if value]
                for key in used_keys:
                    self.assertTrue(
                        any(
                            aircraft._scenario_radius_at(key, index * aircraft.step_seconds) > 0
                            for index in range(aircraft.steps)
                        ),
                        f"{attack.id}:{key}",
                    )
                if attack.id in finite:
                    last_key = used_keys[0]
                    self.assertEqual(
                        aircraft._scenario_radius_at(last_key, 174),
                        0,
                        f"{attack.id} did not recover inside the default horizon",
                    )

    def test_signed_mcdu_bound_is_satisfiable_and_gps_slew_replay_matches_contract(self):
        # A short diagnostic horizon keeps the optional exact encoding below
        # its interactive timeout while still crossing the local T+30 trigger.
        mcdu = SymbolicAircraft("vulnerable", 60, 6, ("mcdu_altitude_tamper",))
        self.assertEqual(str(mcdu.solver().check()), "sat")

        gnss = SymbolicAircraft("vulnerable", 60, 6, ("gnss_spoof",))
        solver = gnss.solver()
        previous = 0.0
        for index, value in enumerate(gnss.gps_bias):
            seconds = index * gnss.step_seconds
            bound = gnss._scenario_radius_at("gps_bias_m", seconds)
            rate = gnss._scenario_bound("gps_bias_rate_mps")[0]
            selected = min(bound, previous + rate * gnss.step_seconds)
            solver.add(value == selected)
            previous = selected
        self.assertEqual(str(solver.check()), "sat")

    def test_witness_trace_preserves_estimated_and_true_position_separation(self):
        result = compute_reachability(["nav_output_tamper"])["profiles"]["vulnerable"]
        self.assertTrue(any(
            abs(sample["estimated_cross_m"] - sample["cross_m"]) > 100
            for sample in result["witness_traces"]["positive"]
        ))

    def test_dynamic_safety_threshold_changes_result(self):
        default = compute_reachability(["gnss_spoof"])
        strict = compute_reachability(
            ["gnss_spoof"],
            {"max_roll_deg": 15, "max_course_deviation_nm": 0.25},
        )
        self.assertFalse(default["profiles"]["vulnerable"]["properties"]["roll"]["violated"] is True)
        self.assertTrue(strict["profiles"]["vulnerable"]["properties"]["roll"]["violated"])
        self.assertLess(
            strict["profiles"]["vulnerable"]["properties"]["course_deviation"]["limit"],
            default["profiles"]["vulnerable"]["properties"]["course_deviation"]["limit"],
        )

    def test_reach_tubes_are_finite_and_ordered(self):
        result = compute_reachability(["gnss_spoof", "convective_gust"])
        for profile in result["profiles"].values():
            for sample in profile["envelope"]:
                for value in sample.values():
                    self.assertTrue(math.isfinite(value))
                self.assertLessEqual(sample["cross_min_m"], sample["cross_max_m"])
                self.assertLessEqual(sample["along_min_m"], sample["along_max_m"])
        self.assertEqual(result["analysis_time_basis"], "scenario-relative local flight condition")

    def test_inverse_query_finds_vulnerable_direct_command_and_secure_block(self):
        result = compute_inverse_reachability(
            {"roll_deg": 36},
            ["afdx_injection"],
            horizon_seconds=90,
            step_seconds=6,
        )
        secure = result["profiles"]["secure"]
        vulnerable = result["profiles"]["vulnerable"]
        self.assertFalse(secure["reachable"])
        self.assertEqual(secure["status"], "unsat")
        self.assertTrue(any(
            item["component_id"] == "afdx_ingress_guard"
            for item in secure["blocking_evidence"]
        ))
        self.assertTrue(vulnerable["reachable"])
        self.assertEqual(vulnerable["status"], "sat")
        self.assertGreater(vulnerable["reached_state"]["roll_deg"], 32)
        self.assertTrue(any(
            item["magnitude_key"] == "roll_injection_deg"
            for item in vulnerable["witness_inputs"]
        ))
        self.assertEqual(
            [item["id"] for item in vulnerable["individually_enabling_scenarios"]],
            ["afdx_injection"],
        )


class ApiTests(unittest.TestCase):
    def setUp(self):
        app.testing = True
        self.client = app.test_client()

    def test_health_and_config(self):
        self.assertEqual(self.client.get("/api/health").status_code, 200)
        response = self.client.get("/api/config")
        self.assertEqual(response.status_code, 200)
        self.assertIn("routes", response.get_json())

    def test_reachability_validation(self):
        response = self.client.post(
            "/api/reachability",
            json={"attack_ids": ["missing-scenario"]},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Unknown attack scenario", response.get_json()["error"])

    def test_reachability_response(self):
        response = self.client.post(
            "/api/reachability",
            json={
                "attack_ids": ["gnss_spoof"],
                "horizon_seconds": 120,
                "step_seconds": 6,
            },
        )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["status"], "complete")
        self.assertEqual(set(payload["profiles"]), {"secure", "vulnerable"})

    def test_explicit_empty_attack_list_runs_nominal_model(self):
        response = self.client.post("/api/reachability", json={"attack_ids": []})
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["attack_ids"], [])
        self.assertEqual(
            payload["profiles"]["secure"]["classification"], "bounded-safe"
        )

    def test_inverse_reachability_endpoint_and_validation(self):
        invalid = self.client.post(
            "/api/inverse-reachability",
            json={"target": {"roll_deg": 80}},
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertIn("roll_deg must be between", invalid.get_json()["error"])

        response = self.client.post(
            "/api/inverse-reachability",
            json={
                "target": {"roll_deg": 36},
                "attack_ids": ["afdx_injection"],
                "horizon_seconds": 90,
                "step_seconds": 6,
            },
        )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["status"], "complete")
        self.assertFalse(payload["profiles"]["secure"]["reachable"])
        self.assertTrue(payload["profiles"]["vulnerable"]["reachable"])


if __name__ == "__main__":
    unittest.main()
