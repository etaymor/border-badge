"""Supabase client for database operations."""

from typing import Any

import httpx

from app.core.config import get_settings


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
        self.headers = {
            "apikey": self.settings.supabase_anon_key,
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    @property
    def rest_url(self) -> str:
        """Get the Supabase REST API URL."""
        return f"{self.base_url}/rest/v1"

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
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.rest_url}/{table}",
                headers=self.headers,
                params=params or {},
            )
            response.raise_for_status()
            return response.json()

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
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.rest_url}/{table}",
                headers=self.headers,
                json=data,
            )
            response.raise_for_status()
            return response.json()

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
        async with httpx.AsyncClient() as client:
            response = await client.patch(
                f"{self.rest_url}/{table}",
                headers=self.headers,
                json=data,
                params=params or {},
            )
            response.raise_for_status()
            return response.json()

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
        async with httpx.AsyncClient() as client:
            response = await client.delete(
                f"{self.rest_url}/{table}",
                headers=self.headers,
                params=params,
            )
            response.raise_for_status()
            return response.json()


def get_supabase_client(user_token: str | None = None) -> SupabaseClient:
    """
    Get a Supabase client instance.

    Args:
        user_token: Optional JWT for user-scoped queries with RLS.
    """
    return SupabaseClient(user_token=user_token)
