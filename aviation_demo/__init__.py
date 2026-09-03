"""ALBATROS aviation demonstrator backend.

The package deliberately separates binary message-flow analysis (the existing
MCS analyser) from bounded aircraft-state reachability.  The former discovers
software paths; the latter adds the physical model that the analyser paper
explicitly leaves out of scope.
"""

from .model import ATTACK_SCENARIOS, ROUTES, SAFETY_DEFAULTS

__all__ = ["ATTACK_SCENARIOS", "ROUTES", "SAFETY_DEFAULTS"]
