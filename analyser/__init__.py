__all__ = ['Coordinator']


def __getattr__(name):
    """Load the angr-backed coordinator only when it is actually requested.

    Importing ``analyser.common.logger`` used to import angr through this
    package initializer before callers could configure dependency logging.
    Lazy loading keeps headless/silent CLI startup genuinely quiet.
    """
    if name == 'Coordinator':
        from .coordinator import Coordinator
        return Coordinator
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
