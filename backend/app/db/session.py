"""Supabase client for database operations."""

import re
from typing import Any

import httpx
from fastapi import HTTPException, status

from app.core.config import get_settings
from app.core.http_client import close_http_client, get_http_client

# Re-export for backward compatibility with main.py import
__all__ = [
    "close_http_client",
    "DatabaseError",
    "get_http_client",
    "get_service_supabase_client",
    "get_supabase_client",
    "SupabaseClient",
]


class DatabaseError(HTTPException):
    """HTTPException carrying structured fields from a PostgREST error.

    The client-facing ``detail`` stays generic ("Database error") so internal
    schema/query information is never forwarded in API responses, while
    ``pg_code`` (SQLSTATE, e.g. ``23505`` for unique_violation or ``P0001``
    for trigger-raised errors), ``message`` and ``constraint`` stay available
    server-side so endpoints can classify the failure (duplicate key,
    block-enforcement trigger, ...) without string-matching a generic detail.
    """

    def __init__(
        self,
        status_code: int,
        *,
        pg_code: str | None = None,
        message: str | None = None,
        constraint: str | None = None,
    ) -> None:
        super().__init__(status_code=status_code, detail="Database error")
        self.pg_code = pg_code
        self.message = message
        self.constraint = constraint


class SupabaseClient:
    """HTTP client for Supabase REST API operations."""

    def __init__(self, user_token: str | None = None) -> None:
        """
        Initialize the Supabase client.

        Args:
            user_token: Optional JWT token for user-scoped queries (RLS).
                       If None, uses service role key (bypasses RLS).
        """
        self.settings = get_settings()
        self.base_url = self.settings.supabase_url

        # Use user token for RLS, or service role for admin operations
        auth_token = user_token or self.settings.supabase_service_role_key
        # Supabase REST expects the apikey header to align with the auth context.
        api_key = (
            self.settings.supabase_anon_key
            if user_token
            else self.settings.supabase_service_role_key
        )
        self.headers = {
            "apikey": api_key,
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    @property
    def rest_url(self) -> str:
        """Get the Supabase REST API URL."""
        return f"{self.base_url}/rest/v1"

    def _handle_http_error(self, e: httpx.HTTPStatusError) -> None:
        """Convert httpx HTTP errors to a DatabaseError.

        The specifics (PostgREST message, code, raw body) are logged server-side
        only; the client receives a generic detail so internal schema/query
        information is never forwarded in API responses. The parsed PostgREST
        fields ride on the raised DatabaseError so callers can classify the
        failure programmatically instead of matching the (generic) detail.
        """
        import logging

        logger = logging.getLogger(__name__)

        pg_code: str | None = None
        message: str | None = None
        constraint: str | None = None

        # Log the specifics server-side for debugging
        try:
            error_body = e.response.json()
            logger.error(f"Supabase HTTP error {e.response.status_code}: {error_body}")
            if isinstance(error_body, dict):
                pg_code = error_body.get("code")
                message = error_body.get("message")
                details = error_body.get("details")
                # Postgres names the violated constraint in the message or
                # details: ... violates unique constraint "user_follow_pkey"
                for text in (message, details):
                    if isinstance(text, str):
                        match = re.search(r'constraint "([^"]+)"', text)
                        if match:
                            constraint = match.group(1)
                            break
        except Exception:
            logger.error(
                f"Supabase HTTP error {e.response.status_code}: {e.response.text[:500]}"
            )

        raise DatabaseError(
            status_code=e.response.status_code,
            pg_code=pg_code,
            message=message,
            constraint=constraint,
        )

    def _handle_request_error(self, e: httpx.RequestError) -> None:
        """Convert httpx request errors to FastAPI HTTPException."""
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database connection error",
        )

    async def get(
        self,
        table: str,
        params: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """
        Fetch records from a table.

        Args:
            table: The table name to query
            params: Optional query parameters (filters, select, etc.)

        Returns:
            List of records matching the query
        """
        try:
            client = get_http_client()
            response = await client.get(
                f"{self.rest_url}/{table}",
                headers=self.headers,
                params=params or {},
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            self._handle_http_error(e)
        except httpx.RequestError as e:
            self._handle_request_error(e)
        return []  # Never reached, but satisfies type checker

    async def post(
        self,
        table: str,
        data: dict[str, Any] | list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """
        Insert records into a table.

        Args:
            table: The table name
            data: Record(s) to insert

        Returns:
            List of inserted records
        """
        try:
            client = get_http_client()
            response = await client.post(
                f"{self.rest_url}/{table}",
                headers=self.headers,
                json=data,
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            self._handle_http_error(e)
        except httpx.RequestError as e:
            self._handle_request_error(e)
        return []

    async def patch(
        self,
        table: str,
        data: dict[str, Any],
        params: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """
        Update records in a table.

        Args:
            table: The table name
            data: Fields to update
            params: Query parameters to filter which records to update

        Returns:
            List of updated records
        """
        try:
            client = get_http_client()
            response = await client.patch(
                f"{self.rest_url}/{table}",
                headers=self.headers,
                json=data,
                params=params or {},
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            self._handle_http_error(e)
        except httpx.RequestError as e:
            self._handle_request_error(e)
        return []

    async def delete(
        self,
        table: str,
        params: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """
        Delete records from a table.

        Args:
            table: The table name
            params: Query parameters to filter which records to delete

        Returns:
            List of deleted records
        """
        try:
            client = get_http_client()
            response = await client.delete(
                f"{self.rest_url}/{table}",
                headers=self.headers,
                params=params,
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            self._handle_http_error(e)
        except httpx.RequestError as e:
            self._handle_request_error(e)
        return []

    async def upsert(
        self,
        table: str,
        data: list[dict[str, Any]],
        on_conflict: str,
    ) -> list[dict[str, Any]]:
        """
        Upsert records (insert or update on conflict).

        Uses Supabase's bulk upsert which is atomic - all records succeed or fail together.

        Args:
            table: The table name
            data: List of records to upsert
            on_conflict: Comma-separated column names for conflict resolution

        Returns:
            List of upserted records
        """
        try:
            client = get_http_client()
            # Merge headers with upsert-specific Prefer header
            headers = {
                **self.headers,
                "Prefer": "return=representation,resolution=merge-duplicates",
            }
            response = await client.post(
                f"{self.rest_url}/{table}",
                headers=headers,
                json=data,
                params={"on_conflict": on_conflict},
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            self._handle_http_error(e)
        except httpx.RequestError as e:
            self._handle_request_error(e)
        return []

    async def count(
        self,
        table: str,
        params: dict[str, Any] | None = None,
    ) -> int:
        """
        Count records in a table using Supabase's count feature.

        Uses the Prefer: count=exact header to get count without fetching rows.

        Args:
            table: The table name to query
            params: Optional query parameters (filters)

        Returns:
            The count of matching records
        """
        try:
            client = get_http_client()
            headers = {
                **self.headers,
                "Prefer": "count=exact",
            }
            # Only select minimal data, we just need the count from headers
            query_params = {**(params or {}), "select": "id", "limit": "0"}
            response = await client.get(
                f"{self.rest_url}/{table}",
                headers=headers,
                params=query_params,
            )
            response.raise_for_status()
            # Count is returned in the Content-Range header: "0-0/123" or "*/123"
            content_range = response.headers.get("Content-Range", "")
            if "/" in content_range:
                return int(content_range.split("/")[-1])
            return 0
        except httpx.HTTPStatusError as e:
            self._handle_http_error(e)
        except httpx.RequestError as e:
            self._handle_request_error(e)
        return 0  # Never reached, but satisfies type checker

    async def rpc(
        self,
        function: str,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """
        Call a Supabase RPC (PostgREST function).

        Args:
            function: The function name to call
            params: Optional parameters to pass to the function

        Returns:
            The RPC function result payload
        """
        try:
            client = get_http_client()
            response = await client.post(
                f"{self.rest_url}/rpc/{function}",
                headers=self.headers,
                json=params or {},
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            self._handle_http_error(e)
        except httpx.RequestError as e:
            self._handle_request_error(e)
        return None


def get_supabase_client(user_token: str | None = None) -> SupabaseClient:
    """
    Get a user-scoped Supabase client (RLS enforced via the user's JWT).

    A user token is REQUIRED. Calling without one used to silently fall back
    to the service role key - a silent RLS bypass that produced real bugs
    (e.g. block-delete no-ops). Service-role access is now explicit-only:
    use get_service_supabase_client() when you actually intend to bypass RLS.

    Args:
        user_token: JWT for user-scoped queries with RLS.

    Raises:
        ValueError: If no user token is provided.
    """
    if not user_token:
        raise ValueError(
            "get_supabase_client() requires a user token. For explicit "
            "service-role (RLS-bypassing) access, call "
            "get_service_supabase_client() instead."
        )
    return SupabaseClient(user_token=user_token)


def get_service_supabase_client() -> SupabaseClient:
    """
    Get a Supabase client with service role key (bypasses RLS).

    Use sparingly - only for admin operations that need to bypass RLS.
    """
    return SupabaseClient(user_token=None)
