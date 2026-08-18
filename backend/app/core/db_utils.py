"""Database utility functions for handling Supabase/PostgREST responses."""

from typing import Any


def get_rpc_first_row(result: Any) -> dict | None:
    """Normalize Supabase RPC responses to extract the first row.

    PostgREST RPC returns different shapes depending on the PostgreSQL function:
    - RETURNS TABLE / SETOF: Returns list[dict] (most common in this codebase)
    - RETURNS jsonb / record: Returns dict directly

    This helper abstracts away that inconsistency for callers that expect a single row.

    Args:
        result: The raw result from a Supabase RPC call

    Returns:
        The first row as a dict, or None if the result is empty/invalid
    """
    if not result:
        return None
    if isinstance(result, dict):
        return result
    if isinstance(result, list) and len(result) > 0 and isinstance(result[0], dict):
        return result[0]
    return None
