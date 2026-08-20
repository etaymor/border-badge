"""Test that FREE_LIMITS constants are consistent across all codebases.

This test ensures that the free tier limits defined in TypeScript, Python, and Swift
remain in sync. If any of these values drift, this test will fail during CI.

Related files:
- mobile/src/stores/subscriptionStore.ts (TypeScript)
- backend/app/api/subscriptions.py (Python)
- mobile/plugins/share-extension/Utilities/AppGroupStorage.swift (Swift)
"""

import re
from pathlib import Path


def test_free_limits_consistency():
    """Verify FREE_LIMITS match across TypeScript, Python, and Swift."""
    root = Path(__file__).parent.parent.parent  # Navigate to project root

    # Read TypeScript values
    ts_file = root / "mobile" / "src" / "stores" / "subscriptionStore.ts"
    ts_content = ts_file.read_text()

    ts_share_match = re.search(r"shareExtension:\s*(\d+)", ts_content)
    ts_photo_match = re.search(r"photoImport:\s*(\d+)", ts_content)
    ts_entries_match = re.search(r"entriesPerTrip:\s*(\d+)", ts_content)

    assert ts_share_match, "Could not find shareExtension in TypeScript file"
    assert ts_photo_match, "Could not find photoImport in TypeScript file"
    assert ts_entries_match, "Could not find entriesPerTrip in TypeScript file"

    ts_share = int(ts_share_match.group(1))
    ts_photo = int(ts_photo_match.group(1))
    ts_entries = int(ts_entries_match.group(1))

    # Read Python values
    from app.api.subscriptions import FREE_LIMITS

    py_share = FREE_LIMITS["share_extension"]
    py_photo = FREE_LIMITS["photo_import"]
    py_entries = FREE_LIMITS["entries_per_trip"]

    # Read Swift value (only defines share extension limit)
    swift_file = (
        root
        / "mobile"
        / "plugins"
        / "share-extension"
        / "Utilities"
        / "AppGroupStorage.swift"
    )
    swift_content = swift_file.read_text()

    swift_share_match = re.search(r"freeShareExtensionLimit\s*=\s*(\d+)", swift_content)
    assert swift_share_match, "Could not find freeShareExtensionLimit in Swift file"
    swift_share = int(swift_share_match.group(1))

    # Assert all match
    assert ts_share == py_share == swift_share, (
        f"Share extension limits don't match: "
        f"TypeScript={ts_share}, Python={py_share}, Swift={swift_share}"
    )
    assert ts_photo == py_photo, (
        f"Photo import limits don't match: TypeScript={ts_photo}, Python={py_photo}"
    )
    assert ts_entries == py_entries, (
        f"Entries per trip limits don't match: "
        f"TypeScript={ts_entries}, Python={py_entries}"
    )

    # Log the verified values for visibility
    print("FREE_LIMITS verified across all codebases:")
    print(f"  share_extension: {ts_share} (TS, PY, Swift)")
    print(f"  photo_import: {ts_photo} (TS, PY)")
    print(f"  entries_per_trip: {ts_entries} (TS, PY)")
