"""CLI flags and teardown for scripts/create_quiz_from_photos.py."""

from __future__ import annotations

import ast
from pathlib import Path

from scripts.create_quiz_from_photos import build_parser

SCRIPT_PATH = (
    Path(__file__).resolve().parents[2] / "scripts" / "create_quiz_from_photos.py"
)


def test_force_and_skip_eligibility_are_aliases() -> None:
    force = build_parser().parse_args(
        [
            "--owner-id",
            "578c63c4-c324-47f1-b3fa-2672e8cb5821",
            "--photos",
            "/tmp/photos",
            "--force",
        ]
    )
    skip = build_parser().parse_args(
        [
            "--owner-id",
            "578c63c4-c324-47f1-b3fa-2672e8cb5821",
            "--photos",
            "/tmp/photos",
            "--skip-eligibility",
        ]
    )
    default = build_parser().parse_args(
        [
            "--owner-id",
            "578c63c4-c324-47f1-b3fa-2672e8cb5821",
            "--photos",
            "/tmp/photos",
        ]
    )
    assert force.skip_eligibility is True
    assert skip.skip_eligibility is True
    assert default.skip_eligibility is False


def _asyncio_run_calls_in_main() -> int:
    tree = ast.parse(SCRIPT_PATH.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "main":
            return sum(
                isinstance(child, ast.Call)
                and isinstance(child.func, ast.Attribute)
                and child.func.attr == "run"
                and isinstance(child.func.value, ast.Name)
                and child.func.value.id == "asyncio"
                for child in ast.walk(node)
            )
    raise AssertionError("main() not found")


def test_main_uses_one_asyncio_run() -> None:
    """close_http_client must not run on a second asyncio.run loop."""
    assert _asyncio_run_calls_in_main() == 1
