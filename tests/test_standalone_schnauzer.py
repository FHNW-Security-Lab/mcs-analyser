import unittest

from aviation_demo.standalone_schnauzer import LINEAGE_SCRIPT, create_server


class StandaloneSchnauzerTests(unittest.TestCase):
    def test_terminal_actor_lineage_module_is_injected_and_served(self):
        server = create_server(web_port=18080, backend_port=18086)
        client = server.app.test_client()

        with client.get('/') as page:
            self.assertEqual(page.status_code, 200)
            self.assertIn(f'src="/{LINEAGE_SCRIPT}"', page.get_data(as_text=True))

        with client.get(f'/{LINEAGE_SCRIPT}') as script:
            self.assertEqual(script.status_code, 200)
            source = script.get_data(as_text=True)
            self.assertIn("actor.predecessors()", source)
            self.assertIn("terminal_actor", source)


if __name__ == '__main__':
    unittest.main()
