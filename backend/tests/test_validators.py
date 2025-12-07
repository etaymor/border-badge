"""Tests for validation utilities."""

import pytest

from app.core.validators import validate_image_url


class TestValidateImageUrl:
    """Tests for validate_image_url function."""

    def test_none_input_returns_none(self):
        """None input should return None without raising."""
        assert validate_image_url(None) is None

    def test_valid_https_url_passes(self):
        """Valid HTTPS URLs should pass validation."""
        url = "https://example.com/image.jpg"
        assert validate_image_url(url) == url

    def test_valid_https_url_with_path_passes(self):
        """HTTPS URLs with complex paths should pass."""
        url = "https://cdn.example.com/users/123/uploads/photo.png?v=1"
        assert validate_image_url(url) == url

    def test_valid_https_url_with_port_passes(self):
        """HTTPS URLs with explicit ports should pass."""
        url = "https://example.com:8443/image.jpg"
        assert validate_image_url(url) == url

    def test_http_url_rejected(self):
        """HTTP (non-secure) URLs should be rejected."""
        with pytest.raises(ValueError, match="https protocol"):
            validate_image_url("http://example.com/image.jpg")

    def test_javascript_url_rejected(self):
        """JavaScript URLs (XSS attack vector) should be rejected."""
        with pytest.raises(ValueError, match="https protocol"):
            validate_image_url("javascript:alert('xss')")

    def test_data_url_rejected(self):
        """Data URLs should be rejected."""
        with pytest.raises(ValueError, match="https protocol"):
            validate_image_url("data:text/html,<script>alert(1)</script>")

    def test_data_image_url_rejected(self):
        """Data image URLs should be rejected."""
        with pytest.raises(ValueError, match="https protocol"):
            validate_image_url("data:image/png;base64,iVBORw0KGgoAAAANS")

    def test_file_url_rejected(self):
        """File URLs should be rejected."""
        with pytest.raises(ValueError, match="https protocol"):
            validate_image_url("file:///etc/passwd")

    def test_ftp_url_rejected(self):
        """FTP URLs should be rejected."""
        with pytest.raises(ValueError, match="https protocol"):
            validate_image_url("ftp://example.com/image.jpg")

    def test_empty_scheme_rejected(self):
        """URLs without scheme should be rejected."""
        with pytest.raises(ValueError, match="https protocol"):
            validate_image_url("example.com/image.jpg")

    def test_url_without_host_rejected(self):
        """URLs without valid host should be rejected."""
        with pytest.raises(ValueError, match="valid host"):
            validate_image_url("https:///path/to/image.jpg")

    def test_url_length_limit(self):
        """URLs exceeding 2048 characters should be rejected."""
        long_path = "a" * 2049
        with pytest.raises(ValueError, match="too long"):
            validate_image_url(f"https://example.com/{long_path}")

    def test_url_at_length_limit_passes(self):
        """URLs exactly at 2048 characters should pass."""
        # "https://x.co/" = 13 chars, so we need 2035 more
        path = "a" * 2035
        url = f"https://x.co/{path}"
        assert len(url) == 2048
        assert validate_image_url(url) == url

    def test_https_scheme_case_insensitive(self):
        """HTTPS scheme check should be case-insensitive."""
        url = "HTTPS://example.com/image.jpg"
        assert validate_image_url(url) == url

    def test_mixed_case_https_passes(self):
        """Mixed case HTTPS scheme should pass."""
        url = "HtTpS://example.com/image.jpg"
        assert validate_image_url(url) == url

    def test_vbscript_url_rejected(self):
        """VBScript URLs (IE attack vector) should be rejected."""
        with pytest.raises(ValueError, match="https protocol"):
            validate_image_url("vbscript:msgbox('xss')")

    def test_empty_string_rejected(self):
        """Empty string should be rejected."""
        with pytest.raises(ValueError, match="https protocol"):
            validate_image_url("")

    def test_whitespace_only_rejected(self):
        """Whitespace-only string should be rejected."""
        with pytest.raises(ValueError, match="https protocol"):
            validate_image_url("   ")
