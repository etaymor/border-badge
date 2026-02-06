"""Tests for SSRF protection in tiktok_proxy_url validation."""

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def _make_settings(**overrides) -> Settings:
    """Create Settings with minimal required fields and custom overrides."""
    defaults = {
        "env": "development",
        "supabase_url": "",
        "supabase_anon_key": "",
        "supabase_service_role_key": "",
        "supabase_jwt_secret": "",
    }
    defaults.update(overrides)
    return Settings(**defaults)


class TestProxyUrlSchemeValidation:
    """Proxy URL must use an allowed scheme."""

    def test_http_scheme_allowed(self):
        s = _make_settings(tiktok_proxy_url="http://proxy.example.com:8080")
        assert s.tiktok_proxy_url == "http://proxy.example.com:8080"

    def test_https_scheme_allowed(self):
        s = _make_settings(tiktok_proxy_url="https://proxy.example.com:8080")
        assert s.tiktok_proxy_url == "https://proxy.example.com:8080"

    def test_socks5_scheme_allowed(self):
        s = _make_settings(tiktok_proxy_url="socks5://proxy.example.com:1080")
        assert s.tiktok_proxy_url == "socks5://proxy.example.com:1080"

    def test_ftp_scheme_rejected(self):
        with pytest.raises(ValidationError, match="must start with one of"):
            _make_settings(tiktok_proxy_url="ftp://proxy.example.com")

    def test_none_returns_none(self):
        s = _make_settings(tiktok_proxy_url=None)
        assert s.tiktok_proxy_url is None

    def test_empty_string_returns_none(self):
        s = _make_settings(tiktok_proxy_url="")
        assert s.tiktok_proxy_url is None


class TestProxyUrlSsrfProtection:
    """Proxy URL must not point to private/reserved IPs or blocked hosts."""

    @pytest.mark.parametrize(
        "ip",
        [
            "10.0.0.1",
            "10.255.255.255",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.0.1",
            "192.168.1.100",
        ],
    )
    def test_private_ipv4_rejected(self, ip):
        with pytest.raises(ValidationError, match="private/reserved IP"):
            _make_settings(tiktok_proxy_url=f"http://{ip}:8080")

    @pytest.mark.parametrize(
        "ip",
        [
            "127.0.0.1",
            "127.0.0.2",
        ],
    )
    def test_loopback_ipv4_rejected(self, ip):
        with pytest.raises(ValidationError, match="private/reserved IP"):
            _make_settings(tiktok_proxy_url=f"http://{ip}:8080")

    def test_cloud_metadata_ipv4_rejected(self):
        with pytest.raises(ValidationError, match="private/reserved IP"):
            _make_settings(tiktok_proxy_url="http://169.254.169.254")

    def test_link_local_ipv4_rejected(self):
        with pytest.raises(ValidationError, match="private/reserved IP"):
            _make_settings(tiktok_proxy_url="http://169.254.1.1:8080")

    def test_ipv6_loopback_rejected(self):
        with pytest.raises(ValidationError, match="private/reserved IP"):
            _make_settings(tiktok_proxy_url="http://[::1]:8080")

    def test_localhost_hostname_rejected(self):
        with pytest.raises(ValidationError, match="blocked host"):
            _make_settings(tiktok_proxy_url="http://localhost:8080")

    def test_metadata_google_internal_rejected(self):
        with pytest.raises(ValidationError, match="blocked host"):
            _make_settings(tiktok_proxy_url="http://metadata.google.internal")

    def test_public_ip_allowed(self):
        s = _make_settings(tiktok_proxy_url="http://203.0.113.50:8080")
        assert s.tiktok_proxy_url == "http://203.0.113.50:8080"

    def test_public_hostname_allowed(self):
        s = _make_settings(tiktok_proxy_url="http://proxy.example.com:8080")
        assert s.tiktok_proxy_url == "http://proxy.example.com:8080"

    def test_socks5_private_ip_rejected(self):
        with pytest.raises(ValidationError, match="private/reserved IP"):
            _make_settings(tiktok_proxy_url="socks5://10.0.0.1:1080")

    def test_socks5_public_ip_allowed(self):
        s = _make_settings(tiktok_proxy_url="socks5://203.0.113.50:1080")
        assert s.tiktok_proxy_url == "socks5://203.0.113.50:1080"

    def test_no_hostname_rejected(self):
        with pytest.raises(ValidationError, match="valid hostname"):
            _make_settings(tiktok_proxy_url="http://:8080")
