from networkx import MultiDiGraph
from distinctipy import get_colors
from colorsys import rgb_to_hls, hls_to_rgb

from analyser.common import logger, MessageTracer, Config
from schnauzer import VisualizationClient
log = logger(__name__)


class MCSGraph(MultiDiGraph):
    """
    A specialized MultiDiGraph for representing CAN bus communication.
    Singleton pattern with reset capability.
    """
    _instance = None
    _initialized = False

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(MCSGraph, cls).__new__(cls)
            cls._instance.vc = VisualizationClient()
            cls._instance.type_color_map = None
        return cls._instance

    def __init__(self):
        # Only initialize the parent class once
        if not MCSGraph._initialized:
            super().__init__()
            MCSGraph._initialized = True

    @classmethod
    def get_instance(cls) -> 'MCSGraph':
        """Get or create the singleton instance"""
        return cls()

    @classmethod
    def reset(cls):
        """Reset the graph while keeping the same instance"""
        if cls._instance is not None:
            cls._instance.clear()  # MultiDiGraph's clear method
            cls._instance.type_color_map = None
            # Don't reset vc - keep the connection
            log.debug("MCSGraph reset")

    @classmethod
    def add_component(cls, name: str, cid: int, description: str):
        """Add a component node to the graph"""
        instance = cls.get_instance()
        instance.add_node(name, name=name, cid=cid, description=description)
        log.debug(f"Added component node: {name}")

    @classmethod
    def add_message_edge(cls, source: str, target: str, message_data: dict) -> bool:
        """Add a message edge between components"""
        instance = cls.get_instance()

        # Check if this exact message already exists
        edge_dict = instance.get_edge_data(source, target)
        if edge_dict:
            for key, edge in edge_dict.items():
                if message_data.get('msg_id') == edge.get('msg_id'):
                    log.debug(f"Message from ({[source]}->{[target]}) already in graph")
                    return False

        # Add the edge with all message data
        instance.add_edge(source, target, **message_data)
        msg_type = message_data.get('type', 'unknown')
        log.debug(f"Added edge {[source]} -> {[target]} with type {[msg_type]}")
        return True

    @staticmethod
    def _build_type_color_map() -> dict[str, str]:
        """Build color map for message types"""
        # Your existing implementation
        msg_type_strs = Config.message_name_lookup.values()

        exclude_colors = [
            (1, 0, 0), (0.9, 0, 0), (0.8, 0, 0), (1, 0.1, 0.1),  # reds
        ]

        colors_rgb = get_colors(len(msg_type_strs) + 10, exclude_colors=exclude_colors)

        pastel_colors = []
        for r, g, b in colors_rgb:
            h, l, s = rgb_to_hls(r, g, b)
            s = s * 0.80
            l = 0.4 + (l * 0.3)
            r, g, b = hls_to_rgb(h, l, s)

            if max(r, g, b) - min(r, g, b) > 0.1:
                pastel_colors.append((r, g, b))

        pastel_colors = pastel_colors[:len(msg_type_strs)]
        colors = ['#%02x%02x%02x' % tuple(int(c*255) for c in color) for color in pastel_colors]

        return dict(zip(msg_type_strs, colors))

    @staticmethod
    def _with_aircraft_plant(graph: MultiDiGraph) -> MultiDiGraph:
        """Add a non-MCA physical consequence layer to an aviation display copy."""
        # MultiDiGraph.copy() constructs ``graph.__class__``. MCSGraph is a
        # singleton, so that would return and mutate the live evidence graph.
        # The visualization overlay must be an intentionally plain graph.
        display_graph = MultiDiGraph(graph)
        schema = str(Config.source_data.get('schema_version', ''))
        if not schema.startswith('albatros.aviation-mca-config/'):
            return display_graph

        physical_nodes = [
            ('CONFIGURED · Autothrust / FADEC', 'configured controller', 'Converts the FMS speed/thrust target into a bounded engine command.'),
            ('PHYSICAL · Ailerons', 'control surface', 'Produces aircraft roll moment.'),
            ('PHYSICAL · Elevator', 'control surface', 'Produces aircraft pitch moment.'),
            ('PHYSICAL · Rudder', 'control surface', 'Produces aircraft yaw moment.'),
            ('PHYSICAL · Engines / thrust', 'propulsion', 'Accepts the FADEC command and produces bounded thrust.'),
        ]
        for name, role, description in physical_nodes:
            display_graph.add_node(
                name,
                name=name,
                type='configured physical actor',
                role=role,
                color='#b78545' if role in {'configured controller', 'control surface', 'propulsion'} else '#708790',
                description=description,
                binary='none — physical plant boundary',
                evidence='configured bounded plant relation; not derived by angr',
            )

        component_name_by_id = {
            data.get('component_id'): name
            for name, data in display_graph.nodes(data=True)
            if data.get('component_id')
        }
        actuator = component_name_by_id.get('actuator_control')
        fms = component_name_by_id.get('flight_management')

        def plant_edge(source: str | None, target: str | None, name: str) -> None:
            if source is None or target is None or source not in display_graph or target not in display_graph:
                return
            display_graph.add_edge(
                source,
                target,
                name=f'PLANT · {name}',
                type='configured physical transition',
                color='#b78545',
                constraint_readable='bounded physical response',
                constraint_meaning='Plant-model relation outside native binary symbolic execution.',
                evidence='configured plant overlay — not MCA-derived',
            )

        for surface in ('PHYSICAL · Ailerons', 'PHYSICAL · Elevator', 'PHYSICAL · Rudder'):
            plant_edge(actuator, surface, 'surface command')
        plant_edge(fms, 'CONFIGURED · Autothrust / FADEC', 'speed / thrust target')
        plant_edge('CONFIGURED · Autothrust / FADEC', 'PHYSICAL · Engines / thrust', 'fuel / thrust command')
        return display_graph

    @classmethod
    def visualize(cls, step_mode=False, tracing=True):
        """Visualize the graph"""

        from analyser.can_simulator import CANBus # Avoiding circular imports

        instance = cls.get_instance()

        # Build color map if needed
        if instance.type_color_map is None:
            instance.type_color_map = instance._build_type_color_map()

        traces = None
        if tracing:
            traces = MessageTracer.get_traces_dict(CANBus.buffer.keys())
        role_colors = {
            'source': '#3f86a5',
            'processor': '#3f7778',
            'safeguard': '#20baa6',
            'effect': '#c89547',
            'sink': '#71858a',
        }

        # Preserve the aircraft architecture metadata in Schnauzer so the
        # standalone inspector can show assurance roles and known defects.
        for node, cid in instance.nodes(data='cid'):
            c = CANBus.components[cid]
            role = c.metadata.get('role')
            if not role:
                role = 'source' if len(c.consumed_ids) == 0 else 'sink' if len(c.produced_ids) == 0 else 'processor'
            instance.nodes[node].update({
                'component_id': c.component_id,
                'type': f'{role} component',
                'role': role,
                'color': role_colors.get(role, '#596be2'),
                'binary': c.path.name,
                'version': c.metadata.get('version', 'not declared'),
                'partition': c.metadata.get('partition', 'not declared'),
                'assurance': c.metadata.get('assurance', 'not declared'),
                'consumes': len(c.consumed_ids),
                'produces': len(c.produced_ids),
            })
            if c.metadata.get('known_defect'):
                instance.nodes[node]['known_defect'] = c.metadata['known_defect']

        # Color edges based on message type
        for u, v, k, d in instance.edges(keys=True, data='type'):
            color = instance.type_color_map.get(d, '#CCCCCC')
            instance.edges[u, v, k]['color'] = color

        system = Config.source_data.get('system', {})
        title = system.get('name', 'MCS Communication')
        profile = Config.source_data.get('profile')
        if profile:
            title = f'{title} · {profile.upper()}'

        display_graph = cls._with_aircraft_plant(instance)
        instance.vc.send_graph(
            display_graph,
            title=title,
            traces=traces
        )

        if step_mode:
            input("\nPress Enter to continue...\n")
