import unittest

from networkx import MultiDiGraph, has_path

from analyser.common import Config
from analyser.common.constraint_summary import summarize_constraint
from analyser.common.mcs_graph import MCSGraph


class ConstraintSummaryTests(unittest.TestCase):
    def test_navigation_summary_distinguishes_secure_and_vulnerable_profiles(self):
        secure = summarize_constraint('MSG_AFDX_VL_NAV_SOLUTION', 'secure', 5)
        vulnerable = summarize_constraint('MSG_AFDX_VL_NAV_SOLUTION', 'vulnerable', 2)
        self.assertIn('at least 2', secure['constraint_readable'])
        self.assertIn('GNSS', vulnerable['constraint_readable'])
        self.assertNotEqual(secure['constraint_meaning'], vulnerable['constraint_meaning'])

    def test_envelope_summary_exposes_direct_mode_bypass(self):
        secure = summarize_constraint('MSG_AFDX_VL_ENVELOPE_COMMAND', 'secure', 15)
        vulnerable = summarize_constraint('MSG_AFDX_VL_ENVELOPE_COMMAND', 'vulnerable', 7)
        self.assertIn('≤ 32°', secure['constraint_readable'])
        self.assertIn('NAV_DIRECT', vulnerable['constraint_readable'])

    def test_unknown_message_keeps_exact_predicate_count_visible(self):
        result = summarize_constraint('MSG_AFDX_VL_EXPERIMENTAL', 'secure', 3)
        self.assertEqual(result['predicate_count'], 3)
        self.assertIn('3 exact symbolic predicates', result['constraint_meaning'])

    def test_aircraft_plant_is_added_only_to_the_display_copy(self):
        graph = MultiDiGraph()
        graph.add_node('Actuator', component_id='actuator_control')
        graph.add_node('Observer', component_id='aircraft_effect')
        Config.source_data = {'schema_version': 'albatros.aviation-mca-config/1.0.0'}
        try:
            display = MCSGraph._with_aircraft_plant(graph)
        finally:
            Config.reset()
        self.assertEqual(len(graph.nodes), 2)
        self.assertEqual(len(display.nodes), 7)
        self.assertIn('CONFIGURED · Autothrust / FADEC', display.nodes)
        self.assertIn('PHYSICAL · Engines / thrust', display.nodes)
        self.assertTrue(any(data.get('evidence') == 'configured plant overlay — not MCA-derived'
                            for *_, data in display.edges(data=True)))

    def test_aircraft_plant_copy_does_not_mutate_singleton_mcs_graph(self):
        MCSGraph.reset()
        graph = MCSGraph.get_instance()
        graph.add_node('Actuator Control Electronics', component_id='actuator_control')
        graph.add_node('Aircraft Dynamics Effect', component_id='aircraft_effect')
        graph.add_node('Flight Management System', component_id='flight_management')
        graph.add_node('Flight Guidance Computer', component_id='flight_guidance')
        graph.add_node('Flight Envelope Protection', component_id='envelope_protection')
        graph.add_node('Navigation Fusion', component_id='navigation_fusion')
        graph.add_node('GNSS Receiver', component_id='gnss_receiver')
        graph.add_node('Inertial Reference System', component_id='inertial_reference')
        graph.add_edge('GNSS Receiver', 'Navigation Fusion', msg_id=1, type='MSG_AFDX_VL_GNSS_FIX')
        graph.add_edge('Inertial Reference System', 'Navigation Fusion', msg_id=2, type='MSG_AFDX_VL_INS_STATE')
        graph.add_edge('Navigation Fusion', 'Flight Management System', msg_id=3, type='MSG_AFDX_VL_NAV_SOLUTION')
        graph.add_edge('Flight Management System', 'Flight Guidance Computer', msg_id=4, type='MSG_AFDX_VL_FMS_TARGET')
        graph.add_edge('Flight Guidance Computer', 'Flight Envelope Protection', msg_id=5, type='MSG_AFDX_VL_GUIDANCE_COMMAND')
        graph.add_edge('Flight Envelope Protection', 'Actuator Control Electronics', msg_id=6, type='MSG_AFDX_VL_ENVELOPE_COMMAND')
        graph.add_edge(
            'Actuator Control Electronics',
            'Aircraft Dynamics Effect',
            msg_id=7,
            type='MSG_AFDX_VL_ACTUATOR_COMMAND',
        )
        Config.source_data = {'schema_version': 'albatros.aviation-mca-config/1.0.0'}
        original_nodes = set(graph.nodes)
        original_edges = list(graph.edges(keys=True, data=True))
        try:
            display = MCSGraph._with_aircraft_plant(graph)
        finally:
            Config.reset()

        self.assertIs(type(display), MultiDiGraph)
        self.assertIn('PHYSICAL · Ailerons', display.nodes)
        display_links = {
            (source, target, data.get('name'))
            for source, target, data in display.edges(data=True)
        }
        self.assertIn(
            ('CONFIGURED · Autothrust / FADEC', 'PHYSICAL · Engines / thrust', 'PLANT · fuel / thrust command'),
            display_links,
        )
        for actor in ('PHYSICAL · Ailerons', 'PHYSICAL · Elevator', 'PHYSICAL · Rudder', 'PHYSICAL · Engines / thrust'):
            self.assertEqual(display.out_degree(actor), 0)
        for source in ('GNSS Receiver', 'Inertial Reference System'):
            for surface in ('PHYSICAL · Ailerons', 'PHYSICAL · Elevator', 'PHYSICAL · Rudder'):
                self.assertTrue(has_path(display, source, surface))
        self.assertEqual(original_nodes, set(graph.nodes))
        self.assertEqual(original_edges, list(graph.edges(keys=True, data=True)))
        self.assertNotIn('PHYSICAL · Ailerons', graph.nodes)
        MCSGraph.reset()


if __name__ == '__main__':
    unittest.main()
