# feat: Improve place matching with fuzzy word comparison

## Overview

Add fuzzy string matching to the place extraction scoring system to handle transliteration differences like "Express" vs "Ekspres" that currently fail with exact word matching.

**Estimated effort:** 1-2 hours
**Risk:** Low (backward compatible, isolated change)

---

## Problem Statement

The current scoring in `backend/app/services/place_extractor/scoring.py` uses exact word matching:

```python
# Current behavior (line ~85-95)
query_words = set(query_normalized.split())
name_words = set(name_normalized.split())
overlap = len(query_words & name_words)  # Exact match only
```

This fails for:
- "Dajti Express" vs "Dajti Ekspres" (0/2 word overlap → low confidence)
- "Cafe" vs "Café" (diacritics handled, but similar patterns exist)
- Minor spelling variations common in transliterated place names

---

## Proposed Solution

Replace exact word matching with fuzzy word matching using `rapidfuzz`:

```python
from rapidfuzz import fuzz

def words_similar(w1: str, w2: str, threshold: float = 80.0) -> bool:
    """Check if two words are similar using fuzzy matching."""
    return fuzz.ratio(w1, w2) >= threshold

# Count fuzzy matches instead of exact
overlap = sum(
    1 for qw in query_words
    if any(words_similar(qw, nw) for nw in name_words)
)
```

---

## Implementation

### Step 1: Add dependency

**File:** `backend/pyproject.toml`

```toml
[tool.poetry.dependencies]
# ... existing deps
rapidfuzz = "^3.6"
```

### Step 2: Update scoring function

**File:** `backend/app/services/place_extractor/scoring.py`

```python
# Add import at top
from rapidfuzz import fuzz

# Add helper function
def _words_similar(word1: str, word2: str, threshold: float = 80.0) -> bool:
    """Check if two words are similar using fuzzy matching.

    Args:
        word1: First word to compare
        word2: Second word to compare
        threshold: Minimum similarity score (0-100) to consider a match

    Returns:
        True if words are similar enough
    """
    if word1 == word2:
        return True
    # Skip very short words for fuzzy matching (too many false positives)
    if len(word1) < 4 or len(word2) < 4:
        return word1 == word2
    return fuzz.ratio(word1, word2) >= threshold


def _calculate_word_overlap(query_words: set[str], name_words: set[str]) -> int:
    """Calculate fuzzy word overlap between query and place name.

    Args:
        query_words: Set of words from the search query
        name_words: Set of words from the place name

    Returns:
        Number of query words that have a fuzzy match in name words
    """
    return sum(
        1 for qw in query_words
        if any(_words_similar(qw, nw) for nw in name_words)
    )
```

Then update the existing `calculate_confidence` function to use `_calculate_word_overlap` instead of set intersection.

---

## Files Changed

| File | Change |
|------|--------|
| `backend/pyproject.toml` | Add `rapidfuzz = "^3.6"` |
| `backend/app/services/place_extractor/scoring.py` | Add fuzzy word matching (~25 lines) |
| `backend/tests/services/place_extractor/test_scoring.py` | Add test cases |

---

## Test Cases

```python
# backend/tests/services/place_extractor/test_scoring.py

def test_words_similar_exact_match():
    assert _words_similar("express", "express") is True

def test_words_similar_transliteration():
    assert _words_similar("express", "ekspres") is True
    assert _words_similar("tower", "tauer") is True

def test_words_similar_different_words():
    assert _words_similar("tokyo", "kyoto") is False
    assert _words_similar("restaurant", "hotel") is False

def test_words_similar_short_words_require_exact():
    # Short words should require exact match to avoid false positives
    assert _words_similar("the", "tea") is False
    assert _words_similar("bar", "car") is False

def test_calculate_word_overlap_fuzzy():
    query = {"dajti", "express"}
    name = {"dajti", "ekspres"}
    assert _calculate_word_overlap(query, name) == 2  # Both match

def test_calculate_word_overlap_partial():
    query = {"tokyo", "tower"}
    name = {"tokyo", "station"}
    assert _calculate_word_overlap(query, name) == 1  # Only "tokyo" matches

def test_confidence_with_transliteration():
    # Integration test
    confidence = calculate_confidence(
        query="Dajti Express",
        place_name="Dajti Ekspres",
        is_first_result=True,
    )
    assert confidence >= 0.7  # Should be high confidence now
```

---

## Acceptance Criteria

- [ ] `rapidfuzz` added to dependencies
- [ ] `_words_similar()` helper function implemented
- [ ] `_calculate_word_overlap()` uses fuzzy matching
- [ ] "Express" vs "Ekspres" returns similarity >= 80
- [ ] Short words (< 4 chars) still require exact match
- [ ] All existing tests pass
- [ ] New test cases pass
- [ ] `poetry run ruff check .` passes
- [ ] `poetry run pytest` passes

---

## Rollout

Ship directly. This is a backward-compatible improvement:
- Higher confidence scores for transliterated matches
- Existing exact matches unaffected
- No new infrastructure required
- No feature flags needed

---

## Future Considerations (Not in Scope)

If this fix doesn't sufficiently improve the ~30% failure rate, investigate:

1. **Log failures first** - Add structured logging to understand why extractions fail
2. **Location context** - Append city/country to queries (3 lines in `_try_candidate`)
3. **Fallback API** - If Autocomplete returns low confidence, try Text Search once

These are separate, incremental improvements - not a 5-phase system rewrite.

---

## References

- Current scoring: `backend/app/services/place_extractor/scoring.py:70-131`
- rapidfuzz docs: https://github.com/rapidfuzz/RapidFuzz
- Original improvement spec: `instructions/extractor-improvements.md`
