"""Tests for PostgREST query builder helpers."""

import pytest

from app.db.postgrest import (
    _quote_value,
    eq,
    gt,
    gte,
    ilike,
    in_list,
    is_null,
    like,
    lt,
    lte,
    neq,
    not_null,
)


class TestQuoteValue:
    """Tests for _quote_value function - edge cases for special characters."""

    def test_simple_value_not_quoted(self):
        """Simple alphanumeric values should not be quoted."""
        assert _quote_value("simple") == "simple"
        assert _quote_value("test123") == "test123"
        assert _quote_value("ABC") == "ABC"

    def test_comma_quoted(self):
        """Values with commas must be quoted."""
        assert _quote_value("has,comma") == '"has,comma"'
        assert _quote_value("a,b,c") == '"a,b,c"'

    def test_parentheses_quoted(self):
        """Values with parentheses must be quoted."""
        assert _quote_value("has(paren)") == '"has(paren)"'
        assert _quote_value("(start") == '"(start"'
        assert _quote_value("end)") == '"end)"'

    def test_double_quotes_escaped_and_quoted(self):
        """Double quotes must be escaped by doubling and value quoted."""
        assert _quote_value('has"quote') == '"has""quote"'
        assert _quote_value('"quoted"') == '"""quoted"""'
        assert _quote_value('a"b"c') == '"a""b""c"'

    def test_semicolon_quoted(self):
        """Semicolons must be quoted to prevent injection."""
        assert _quote_value("has;semicolon") == '"has;semicolon"'
        assert _quote_value("val;DROP TABLE") == '"val;DROP TABLE"'

    def test_backslash_quoted(self):
        """Backslashes must be quoted."""
        assert _quote_value("has\\backslash") == '"has\\backslash"'
        assert _quote_value("path\\to\\file") == '"path\\to\\file"'

    def test_colon_quoted(self):
        """Colons must be quoted to prevent operator confusion."""
        assert _quote_value("has:colon") == '"has:colon"'
        assert _quote_value("key:value") == '"key:value"'

    def test_period_quoted(self):
        """Periods must be quoted to prevent field access interpretation."""
        assert _quote_value("has.period") == '"has.period"'
        assert _quote_value("file.txt") == '"file.txt"'

    def test_multiple_special_chars(self):
        """Values with multiple special characters handled correctly."""
        assert _quote_value('a,b;c"d') == '"a,b;c""d"'
        assert _quote_value("(a.b:c)") == '"(a.b:c)"'

    def test_empty_string(self):
        """Empty string should not be quoted."""
        assert _quote_value("") == ""

    def test_whitespace_only(self):
        """Whitespace-only values should not be quoted (no special chars)."""
        assert _quote_value("   ") == "   "
        assert _quote_value("\t\n") == "\t\n"

    def test_unicode_values(self):
        """Unicode values without special chars should not be quoted."""
        assert _quote_value("日本語") == "日本語"
        assert _quote_value("émoji🎉") == "émoji🎉"

    def test_unicode_with_special_chars(self):
        """Unicode values with special chars should be quoted."""
        assert _quote_value("日本,語") == '"日本,語"'


class TestEq:
    """Tests for eq filter builder."""

    def test_basic_eq(self):
        assert eq("value") == "eq.value"

    def test_uuid_eq(self):
        assert eq("123e4567-e89b-12d3-a456-426614174000") == (
            "eq.123e4567-e89b-12d3-a456-426614174000"
        )


class TestNeq:
    """Tests for neq filter builder."""

    def test_basic_neq(self):
        assert neq("value") == "neq.value"


class TestInList:
    """Tests for in_list filter builder."""

    def test_single_value(self):
        assert in_list(["value"]) == "in.(value)"

    def test_multiple_values(self):
        assert in_list(["a", "b", "c"]) == "in.(a,b,c)"

    def test_empty_list_raises(self):
        with pytest.raises(ValueError, match="at least one value"):
            in_list([])

    def test_values_with_special_chars(self):
        """Values requiring quoting should be properly escaped in list."""
        assert in_list(["a,b", "c"]) == 'in.("a,b",c)'
        assert in_list(['a"b']) == 'in.("a""b")'
        assert in_list(["a;b", "c:d"]) == 'in.("a;b","c:d")'


class TestNullFilters:
    """Tests for is_null and not_null filters."""

    def test_is_null(self):
        assert is_null() == "is.null"

    def test_not_null(self):
        assert not_null() == "not.is.null"


class TestComparisonFilters:
    """Tests for gt, gte, lt, lte filters."""

    def test_gt(self):
        assert gt("10") == "gt.10"

    def test_gte(self):
        assert gte("10") == "gte.10"

    def test_lt(self):
        assert lt("10") == "lt.10"

    def test_lte(self):
        assert lte("10") == "lte.10"


class TestLikeFilters:
    """Tests for like and ilike filters."""

    def test_like(self):
        assert like("*test*") == "like.*test*"

    def test_ilike(self):
        assert ilike("*TEST*") == "ilike.*TEST*"
