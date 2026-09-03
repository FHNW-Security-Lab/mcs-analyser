from analyser.common.logger import logger, set_project_log_level, set_dependency_log_level
from logging import DEBUG, INFO, WARNING, ERROR

log = logger(__name__)
set_dependency_log_level(ERROR)  # Keep dependencies quiet
import argparse
from pathlib import Path
import os

from analyser import Coordinator

COMPONENTS_DIR = Path(__file__).parent / "bin"

COMPONENT_DICT = {
    1: 'c1',
    2: 'c2',
    3: 'c3',
    4: 'c4',
    5: 'c5',
}

def get_component_paths() -> list[Path]:
    """
    Load all components from the 'components' directory.
    """
    if not COMPONENTS_DIR.exists():
        log.error(f"Components directory {COMPONENTS_DIR} does not exist.")
        return []

    components = []
    for f in COMPONENTS_DIR.iterdir():
        if f.is_file() and os.access(f, os.X_OK):
            components.append(f)
            log.info(f"Loaded component: {f}")

    return components


def main():
    parser = argparse.ArgumentParser(description='CAN Bus Analysis Coordinator')
    parser.add_argument('--config', '-c', type=Path,
                       help='Path to configuration file (default: config.json in current directory)')
    parser.add_argument('--step', '-s', action='store_true',
                       help='Step through analysis phases with pauses for visualization')
    parser.add_argument('--debug', '-d', action='store_true',
                       help='Enable debug logging (verbose output)')
    parser.add_argument('--silent', '-q', action='store_true',
                       help='Enable silent mode (warnings and errors only)')
    parser.add_argument('--no-visualize', action='store_true',
                       help='Run headlessly without sending data to Schnauzer')
    parser.add_argument('--export-json', type=Path,
                       help='Write a strict machine-readable analysis snapshot')

    args = parser.parse_args()

    # Set logging level based on arguments
    if args.debug:
        project_level = DEBUG
    elif args.silent:
        project_level = WARNING
    else:
        project_level = INFO  # Default

    # Set the logging levels
    set_project_log_level(project_level)

    # Log the current mode
    if args.debug:
        log.debug("Running in DEBUG mode - verbose logging enabled")
    elif args.silent:
        # Won't show at WARNING level, but that's ok
        pass
    else:
        log.info("Running in normal mode - INFO level logging")

    # Use provided config path or default to config.json
    config_path = args.config if args.config else Path.cwd() / "config.json"

    if not config_path.exists():
        log.error(f"Configuration file not found: {config_path}")
        return

    if args.step and args.no_visualize:
        log.warning("--step has no effect together with --no-visualize")

    co = Coordinator()
    co.run(
        config_path=config_path,
        step_mode=args.step,
        visualize=not args.no_visualize,
        export_path=args.export_json,
    )


if __name__ == "__main__":
    main()
