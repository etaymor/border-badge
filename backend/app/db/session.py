"""Supabase client for database operations."""

from typing import Any

import httpx
from fastapi import HTTPException, status

from app.core.config import get_settings

# Module-level shared HTTP client for connection pooling
_shared_client: httpx.AsyncClient | None = None


def get_http_client() -> httpx.AsyncClient:
    """Get or create the shared HTTP client with connection pooling."""
    global _shared_client
    if _shared_client is None:
        _shared_client = httpx.AsyncClient(
            timeout=30.0,
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=100),
        )
    return _shared_client


async def close_http_client() -> None:
    """Close the shared HTTP client. Call this on application shutdown."""
    global _shared_client
    if _shared_client:
        await _shared_client.aclose()
        _shared_client = None


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
        """Convert httpx HTTP errors to FastAPI HTTPException."""
        import logging

        logger = logging.getLogger(__name__)

        # Try to extract error message from response
        try:
            error_body = e.response.json()
            error_detail = error_body.get("message", e.response.text[:200])
            logger.error(f"Supabase HTTP error {e.response.status_code}: {error_body}")
        except Exception:
            error_detail = e.response.text[:200] if e.response.text else "Unknown error"
            logger.error(
                f"Supabase HTTP error {e.response.status_code}: {e.response.text[:500]}"
            )

        raise HTTPException(
            status_code=e.response.status_code,
            detail=f"Database error: {error_detail}",
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
        import logging

        logger = logging.getLogger(__name__)
        try:
            client = get_http_client()
            url = f"{self.rest_url}/{table}"
            logger.debug(
                "SupabaseClient.get: url=%s, params=%s",
                url,
                params,
            )
            response = await client.get(
                url,
                headers=self.headers,
                params=params or {},
            )
            logger.debug(
                "SupabaseClient.get: request_url=%s, status=%s",
                response.request.url,
                response.status_code,
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
    Get a Supabase client instance.

    Args:
        user_token: Optional JWT for user-scoped queries with RLS.
    """
    return SupabaseClient(user_token=user_token)
