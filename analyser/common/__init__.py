"""
This sub-package contains many helper classes and functions that are used throughout the analyser.
"""

from analyser.common.logger import logger, set_project_log_level, set_dependency_log_level
from .config import Config
from .indexed_set import IndexedSet
from .message_tracer import MessageTracer

__all__ = ['Config', 'IndexedSet', 'MessageTracer', 'logger', 'set_project_log_level', 'set_dependency_log_level', 'IOState']


def __getattr__(name):
    """Delay the angr-dependent IOState import until logging is configured."""
    if name == 'IOState':
        from .io_state import IOState
        return IOState
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
