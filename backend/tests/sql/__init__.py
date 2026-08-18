"""SQL-layer tests that run against a real migrated Postgres database.

These tests are marked ``@pytest.mark.sql`` and auto-skip unless the
``SUPABASE_DB_URL`` environment variable points at a database with all
migrations applied (e.g. a local Supabase stack or CI database).
"""
