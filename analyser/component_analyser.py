import re
import angr
from angr import SimState, SimulationManager

from analyser.io import InputHookRegistry, InputTracker, OutputChecker, setup_output_checker
from analyser.can_simulator import Component, Message, CANBus
from analyser.common import logger, Config
log = logger(__name__)

NUM_FIND = 100
MAX_OUTPUT_CONTINUATION_ROUNDS = 16

class ComponentAnalyser:

    def __init__(self, component: Component):
        """
        The `ComponentAnalyser` class holds the angr.project of the binary of the component and essentially acts as a
        sophisticated wrapper for `angr.explore()`.

        During initialisation the Analyser is prepared for the analysis:

        1. Initialize an angr.Project and create a CFG_Emulated.
        2. Retrieve Input / Output function addresses from the CFG_Emulated.
        3. Simulate the binary to retrieve entrypoint states to start analysis from.
        4. Register an `OutputChecker` to later parse outputs.
        5. Hook input addresses using the InputHookRegistry.

        From this state, multiple analysis calls can be performed.

        :param component: The component to analyse.
        """
        self.component: Component = component
        self.current_input_combinations = None

        self.input_hook_registry: InputHookRegistry = InputHookRegistry()
        self.proj = angr.Project(self.component.path, auto_load_libs=False)
        self.cfg = self.proj.analyses.CFGEmulated()
        self.input_addrs = self._find_addr(Config.input_hooks)
        output_is_optional = self.component.metadata.get('role') == 'sink'
        self.output_addrs = self._find_addr(
            Config.output_hooks,
            warn_if_missing=not output_is_optional,
        )
        self.entry_points = self._get_sim_states(self.input_addrs.keys())
        self.output_checker = setup_output_checker(self.component, self.output_addrs)

        for addr, func_name in self.input_addrs.items():
            if not self.proj.is_hooked(addr):
                hook = self.input_hook_registry.create_hook(func_name)
                self.proj.hook(addr, hook)
                log.debug(f"Hooked {func_name} at {hex(addr)} with {hook.__class__.__name__}")

        log.info(f"Initialized ComponentAnalyser for {self.component}")
        log.info(f"Input Functions {[(name, hex(addr)) for addr, name in self.input_addrs.items()]}")
        log.info(f"Output Functions {[(name, hex(addr)) for addr, name in self.output_addrs.items()]}")

    def analyse(self) -> None:
        """
        Analyses the `Component` of this `ComponentAnalyser`.

        6. Prepare a new InputTracker for this component and run as many analysis runs as there are
        available input combinations. If the component has not been analysed yet, InputTracker will only
        have one next combination which is with unconstrained input.

        7. Soft reset the InputTracker (resets various counters but keeps the input combination)

        8. Copy the entrypoint state to keep the original entry points clean.

        9. Add a breakpoint on 'call' statements and perform a "check()" before each call instruction.

        10. Explore towards output addresses. If no output addresses are found (consumer only component),
        simply step for some time before analysing the constraints on the inputs.
        :return:
        """
        log.info(f"\n=== Analysing {self.component} ===")
        InputTracker.track(self.component)
        while InputTracker.has_next_combination():
            for entry_point in self.entry_points:

                InputTracker.soft_reset()
                entry_point_copy = entry_point.copy()

                entry_point_copy.inspect.b(
                    'call',
                    when=angr.BP_BEFORE,
                    action=lambda state: self._capture_output(state)
                )

                simgr: SimulationManager = self.proj.factory.simgr(entry_point_copy)

                if self.output_addrs:
                    log.debug(f"Finding all solutions from {entry_point_copy.addr:#x}")
                    simgr.explore(
                        find=list(self.output_addrs.keys()),
                        cfg=self.cfg,
                        num_find=NUM_FIND,
                    )

                    solution_count = 0
                    current_batch = simgr.found
                    continuation_round = 0
                    log.debug(f"Found {len(current_batch)} initial solutions. Exploring deeper within the binary...")
                    while current_batch and continuation_round < MAX_OUTPUT_CONTINUATION_ROUNDS:
                        solution_count += len(current_batch)
                        additional_solutions = []
                        for state in current_batch:
                            new_simgr = self.proj.factory.simgr(state.copy())
                            new_simgr.step()
                            # A found state is at an external output PLT entry.
                            # CFGEmulated does not model the continuation back from
                            # that stub reliably, so reusing it here prunes valid
                            # later output calls on the same native execution path.
                            new_simgr.explore(
                                find=list(self.output_addrs.keys()),
                                num_find=NUM_FIND,
                            )
                            additional_solutions.extend(new_simgr.found)
                        current_batch = additional_solutions
                        continuation_round += 1
                    if current_batch:
                        log.warning(
                            f"Stopped output continuation after {MAX_OUTPUT_CONTINUATION_ROUNDS} rounds "
                            f"for {self.component.name}"
                        )
                    log.info(f"Found {solution_count} solutions.")
                else:
                    all_states = []
                    step_count = 0
                    max_steps = 10000

                    while simgr.active and step_count < max_steps:
                        # Collect all active states before stepping
                        all_states.extend(simgr.active)
                        simgr.step()
                        step_count += 1

                    # Also collect any remaining active states
                    all_states.extend(simgr.active)

                    log.debug(f"stepped {step_count} steps and explored {len(all_states)} states")
                    log.debug(f"read {InputTracker.input_counter} inputs but consumed {InputTracker.consumed_messages} messages")

                    if InputTracker.yield_unconstrained:
                        # Extract consumed IDs from ALL explored states
                        for state in all_states:
                            OutputChecker.extract_consumed_ids(self.component, state)
                        self.component.update_max_expected_inputs(InputTracker.max_inputs_counted)
                    CANBus.update_graph(self.component.name, InputTracker.get_consumed_messages())
        log.info(f"==================================\n")

    def _capture_output(self, state: SimState):
        """
        Internal function to capture output from an individual analysis run. Should not be called directly.

        11. Check if we're at an output function and if so, update various flags and counters
        12. Write the captured output to the CAN bus.

        :param state:
        :return:
        """
        result: Message | None = self.output_checker.check(state, self.output_addrs.keys())
        if result is not None:
            self.component.update_max_expected_inputs(InputTracker.max_inputs_counted)
            # Preserve discovery-run provenance through the full component chain.
            # Without this, an output derived from a synthetic unconstrained bus
            # message becomes indistinguishable from a genuinely reachable one as
            # soon as it passes through a second component.
            consumed_messages = InputTracker.get_consumed_messages()
            if ((InputTracker.yield_unconstrained and len(self.component.consumed_ids) > 0)
                    or any(message.from_unconstrained_run for message in consumed_messages)):
                result.from_unconstrained_run = True
            if result.msg_type.is_symbolic():
                log.warning(f"{self.component.name} produced a symbolic msg_id {result.msg_type}")
            else:
                self.component.add_production(result.msg_type.bv.concrete_value)

            CANBus.write(result, consumed_messages)


    def _find_addr(self, names: list[str], *, warn_if_missing: bool = True):
        """
        Find addresses of functions matching the given names.
        :param names:
        :return:
        """
        escaped_names = [re.escape(name) for name in names]
        pattern = re.compile("|".join(escaped_names))

        log.debug(f"Finding addresses of functions matching pattern {pattern}")
        found = {}

        for func in self.cfg.kb.functions.values():
            if func.name and pattern.search(func.name):
                section = self.proj.loader.find_section_containing(func.addr)
                if section and section.is_executable:
                    log.debug(f"Found {func.name} at {hex(func.addr)}")
                    normalized_name = InputHookRegistry.normalize_function_name(func.name)
                    found[func.addr] = normalized_name
                else:
                    log.debug(f"Ignoring {func.name} at {hex(func.addr)} as it is not executable. Probably a GOT entry")
        if not found and warn_if_missing:
            log.warning(f"No addresses found for {pattern}")
        elif not found:
            log.debug(
                f"No output addresses expected for consumer-only component "
                f"{self.component.name}"
            )
        return found


    def _get_sim_states(self, addrs, entry_point: SimState=None) -> list[SimState]:
        """
        Explore the CFG and retrieve the SimStates of the given addresses
        :param addrs:
        :return:
        """

        initial_state: SimState = self.proj.factory.entry_state() if entry_point is None else entry_point
        simgr: SimulationManager = self.proj.factory.simgr(initial_state)

        log.debug(f"Getting SimStates for {[hex(x) for x in addrs]}")

        simgr.explore(find=list(addrs), num_find=NUM_FIND, cfg=self.cfg)
        if not simgr.found:
            log.error("Could not reach any addresses")
            return list()
        else:
            n = len(simgr.found)
            if n == NUM_FIND:
                log.warning(f"Hit the maximum number of solutions ({n}), consider increasing the 'NUM_FIND' parameter.")
            log.debug(f"Found {len(simgr.found)} SimStates for {[hex(x) for x in addrs]}")
            return simgr.found
