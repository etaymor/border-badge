"""PostgREST query builder helpers.

This module provides type-safe helper functions for building PostgREST query
parameters. These helpers ensure consistent query construction and provide
validation where appropriate.

Security Note:
    PostgREST filters (eq, in, etc.) are generally safe from SQL injection
    because PostgREST parameterizes queries. However, user input MUST still
    be validated before use to prevent:
    - Logic errors (invalid enum values, malformed UUIDs)
    - Denial of service (extremely long strings)
    - Information disclosure (querying unintended data)

    Always validate user-supplied values against whitelists or expected formats
    BEFORE passing them to these helpers.

Usage:
    from app.db.postgrest import eq, in_list, is_null, not_null

    # For validated user input (region validated against VALID_REGIONS):
    params = {"region": eq(region)}

    # For database-derived values (UUIDs from previous queries):
    params = {"id": eq(row["id"])}

    # For enum values:
    params = {"status": in_list([s.value for s in statuses])}
"""


def eq(value: str) -> str:
    """Build a PostgREST equality filter.

    Args:
        value: The value to match. MUST be validated before calling.

    Returns:
        PostgREST filter string like "eq.value"

    Example:
        >>> eq("Africa")
        'eq.Africa'
        >>> eq("123e4567-e89b-12d3-a456-426614174000")
        'eq.123e4567-e89b-12d3-a456-426614174000'
    """
    return f"eq.{value}"


def neq(value: str) -> str:
    """Build a PostgREST not-equal filter.

    Args:
        value: The value to exclude. MUST be validated before calling.

    Returns:
        PostgREST filter string like "neq.value"
    """
    return f"neq.{value}"


def _quote_value(value: str) -> str:
    """Quote a value for PostgREST if it contains special characters.

    PostgREST uses double-quoting for values with commas, parentheses, quotes,
    and other special characters that could affect query parsing.
    Double quotes inside the value are escaped by doubling them.

    Args:
        value: The value to potentially quote.

    Returns:
        The value, quoted if necessary.

    Example:
        >>> _quote_value("simple")
        'simple'
        >>> _quote_value("has,comma")
        '"has,comma"'
        >>> _quote_value('has"quote')
        '"has""quote"'
        >>> _quote_value("has;semicolon")
        '"has;semicolon"'
    """
    # Characters that require quoting in PostgREST
    # Includes: comma, parentheses, quotes, semicolons, backslashes, colons, periods
    # These could otherwise be interpreted as query syntax
    special_chars = (",", "(", ")", '"', ";", "\\", ":", ".")
    needs_quoting = any(c in value for c in special_chars)
    if not needs_quoting:
        return value
    # Escape double quotes by doubling them, then wrap in quotes
    escaped = value.replace('"', '""')
    return f'"{escaped}"'


def in_list(values: list[str]) -> str:
    """Build a PostgREST IN filter.

    Args:
        values: List of values to match. Each MUST be validated before calling.
                Empty list will raise ValueError.

    Returns:
        PostgREST filter string like "in.(val1,val2,val3)"

    Raises:
        ValueError: If values list is empty.

    Example:
        >>> in_list(["visited", "wishlist"])
        'in.(visited,wishlist)'
        >>> in_list(["a,b", "c"])
        'in.("a,b",c)'
    """
    if not values:
        raise ValueError("in_list requires at least one value")
    quoted_values = [_quote_value(v) for v in values]
    return f"in.({','.join(quoted_values)})"


def is_null() -> str:
    """Build a PostgREST IS NULL filter.

    Returns:
        PostgREST filter string "is.null"
    """
    return "is.null"


def not_null() -> str:
    """Build a PostgREST IS NOT NULL filter.

    Returns:
        PostgREST filter string "not.is.null"
    """
    return "not.is.null"


def gt(value: str) -> str:
    """Build a PostgREST greater-than filter.

    Args:
        value: The value to compare against. MUST be validated before calling.

    Returns:
        PostgREST filter string like "gt.value"
    """
    return f"gt.{value}"


def gte(value: str) -> str:
    """Build a PostgREST greater-than-or-equal filter.

    Args:
        value: The value to compare against. MUST be validated before calling.

    Returns:
        PostgREST filter string like "gte.value"
    """
    return f"gte.{value}"


def lt(value: str) -> str:
    """Build a PostgREST less-than filter.

    Args:
        value: The value to compare against. MUST be validated before calling.

    Returns:
        PostgREST filter string like "lt.value"
    """
    return f"lt.{value}"


def lte(value: str) -> str:
    """Build a PostgREST less-than-or-equal filter.

    Args:
        value: The value to compare against. MUST be validated before calling.

    Returns:
        PostgREST filter string like "lte.value"
    """
    return f"lte.{value}"


def like(pattern: str) -> str:
    """Build a PostgREST LIKE filter.

    Args:
        pattern: The LIKE pattern. Use * for wildcard. MUST be validated.

    Returns:
        PostgREST filter string like "like.pattern"

    Example:
        >>> like("*test*")
        'like.*test*'
    """
    return f"like.{pattern}"


def ilike(pattern: str) -> str:
    """Build a PostgREST case-insensitive LIKE filter.

    Args:
        pattern: The LIKE pattern. Use * for wildcard. MUST be validated.

    Returns:
        PostgREST filter string like "ilike.pattern"
    """
    return f"ilike.{pattern}"
