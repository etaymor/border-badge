"""Supabase Auth admin operations."""

import logging

import httpx

logger = logging.getLogger(__name__)


async def create_user(
    client: httpx.AsyncClient,
    supabase_url: str,
    service_role_key: str,
    email: str,
    password: str,
    username: str,
) -> str:
    """Create auth user with username in metadata. Returns user_id."""
    response = await client.post(
        f"{supabase_url}/auth/v1/admin/users",
        headers={
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        },
        json={
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"username": username},
        },
    )

    if response.status_code == 422:
        error = response.json()
        if "already been registered" in str(error):
            logger.info(f"  User {email} exists, fetching ID...")
            return await get_user_id_by_email(
                client, supabase_url, service_role_key, email
            )
        raise Exception(f"Failed to create user: {error}")

    if response.status_code >= 400:
        error = response.json() if response.text else response.text
        raise Exception(f"Auth API error {response.status_code}: {error}")

    return response.json()["id"]


async def get_user_id_by_email(
    client: httpx.AsyncClient,
    supabase_url: str,
    service_role_key: str,
    email: str,
) -> str:
    """Get user ID by email."""
    response = await client.get(
        f"{supabase_url}/auth/v1/admin/users",
        headers={
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
        },
    )
    response.raise_for_status()
    for user in response.json().get("users", []):
        if user.get("email") == email:
            return user["id"]
    raise Exception(f"User {email} not found")


async def delete_user(
    client: httpx.AsyncClient,
    supabase_url: str,
    service_role_key: str,
    user_id: str,
) -> None:
    """Delete auth user."""
    response = await client.delete(
        f"{supabase_url}/auth/v1/admin/users/{user_id}",
        headers={
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
        },
    )
    if response.status_code not in (200, 204, 404):
        response.raise_for_status()
