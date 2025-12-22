"""Logging configuration for the application."""

import logging
import sys


def setup_logging(debug: bool = False) -> None:
    """Configure logging for the application.

    Args:
        debug: If True, sets log level to DEBUG, otherwise INFO
    """
    log_level = logging.DEBUG if debug else logging.INFO

    # Configure root logger
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        stream=sys.stdout,
        force=True,  # Override any existing config
    )

    # Set specific loggers
    # Reduce noise from httpx and httpcore
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

    # Ensure our app loggers are at the right level
    logging.getLogger("app").setLevel(log_level)

    logging.info(f"Logging configured: level={logging.getLevelName(log_level)}")
