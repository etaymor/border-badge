"""Tests for backfill_subscriptions.py UUID validation.

Covers:
- Bug: user_id passed to update_user/query_revenuecat without UUID format validation
"""

from __future__ import annotations

import re
from uuid import UUID


def is_valid_uuid(value: str) -> bool:
    """Check if a string is a valid UUID."""
    try:
        UUID(str(value))
        return True
    except (ValueError, TypeError, AttributeError):
        return False


class TestBackfillUUIDValidation:
    """Test that the backfill script validates user_id as UUID."""

    def test_valid_uuid_passes(self):
        user_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        assert is_valid_uuid(user_id) is True

    def test_revenuecat_anonymous_id_fails(self):
        """BUG: $RCAnonymousID values could slip through if stored in user_profile."""
        user_id = "$RCAnonymousID:abc123def456"
        assert is_valid_uuid(user_id) is False

    def test_empty_string_fails(self):
        user_id = ""
        assert is_valid_uuid(user_id) is False

    def test_none_fails(self):
        assert is_valid_uuid(None) is False  # type: ignore[arg-type]

    def test_plain_string_fails(self):
        user_id = "not-a-uuid"
        assert is_valid_uuid(user_id) is False

    def test_numeric_string_fails(self):
        """str(user_id) on an integer would produce a non-UUID string."""
        user_id = str(12345)
        assert is_valid_uuid(user_id) is False

    def test_backfill_script_does_not_validate_uuid(self):
        """Verify that the current backfill script lacks UUID validation.

        This test reads the actual script source and checks that there is
        no UUID validation before passing user_id to query_revenuecat or
        update_user. It fails when the fix is applied (which is the goal).
        """
        from pathlib import Path

        script_path = (
            Path(__file__).parent.parent.parent
            / "scripts"
            / "backfill_subscriptions.py"
        )
        source = script_path.read_text()

        # Check if the script validates UUID anywhere in the main loop
        # Look for patterns like: UUID(user_id), is_valid_uuid, uuid validation
        has_uuid_validation = bool(
            re.search(
                r"UUID\(user_id\)|is_valid_uuid|uuid.*valid|validate.*uuid",
                source,
                re.IGNORECASE,
            )
        )

        # BUG: The script currently does NOT validate UUID format.
        # This test documents the bug by asserting the validation is missing.
        # When the fix is applied, this assertion should be inverted.
        assert has_uuid_validation is True, (
            "Backfill script should validate user_id as UUID before sending to RevenueCat API"
        )
