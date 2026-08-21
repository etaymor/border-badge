"""Guard against the photo_vision <-> place_matcher import cycle.

The cycle that prompted this file was invisible to the rest of the suite:
`conftest` imports `app.main`, which happens to initialise `place_matcher`
before `photo_vision`, so the modules resolve and 1243 tests passed while
`scripts/eval_place_matcher.py` could not import at all.

Each case therefore runs in a FRESH INTERPRETER. Importing in-process would
prove nothing -- by the time a test body runs, `sys.modules` is already
populated in an order that hides the cycle.
"""

import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[2]

# Every module that sits on the photo_vision <-> place_matcher boundary. Each
# must be importable as the FIRST thing an interpreter does.
ENTRY_POINTS = [
    "app.services.photo_vision",
    "app.services.photo_vision.classifier",
    "app.services.photo_vision.constants",
    "app.services.place_matcher",
    "app.services.place_matcher.instrumentation",
    "app.services.place_matcher._matcher_cluster_processing",
    "app.services.place_matcher._matcher_ranking",
]


@pytest.mark.parametrize("module", ENTRY_POINTS)
def test_module_imports_first_without_cycle(module: str) -> None:
    """Importing `module` before anything else must not raise ImportError."""
    result = subprocess.run(
        [sys.executable, "-c", f"import {module}"],
        cwd=BACKEND_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, (
        f"`import {module}` failed as the first import in a fresh interpreter.\n"
        f"This is the import-cycle regression this test exists to catch.\n"
        f"{result.stderr}"
    )


def test_classifier_does_not_import_place_matcher_at_module_scope() -> None:
    """The specific edge that closed the cycle, asserted structurally.

    `record_vision` is imported at its call site on purpose. Hoisting it back
    to module scope would reintroduce the cycle, so pin it here as well as
    behaviourally above -- this failure message names the fix directly.
    """
    source = (
        BACKEND_ROOT / "app" / "services" / "photo_vision" / "classifier.py"
    ).read_text()
    module_scope = [
        line
        for line in source.splitlines()
        if line.startswith("from app.services.place_matcher")
        or line.startswith("import app.services.place_matcher")
    ]
    assert not module_scope, (
        "classifier.py imports place_matcher at module scope: "
        f"{module_scope}. place_matcher imports photo_vision, so this closes an "
        "import cycle. Import it inside the function that needs it instead."
    )
