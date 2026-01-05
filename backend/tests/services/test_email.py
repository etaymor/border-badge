"""Tests for email service functionality."""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services.email import (
    TEMPLATES_DIR,
    WELCOME_EMAILS,
    _load_template_content,
    _redact_email,
    load_email_template,
    schedule_welcome_emails,
)


class TestLoadEmailTemplate:
    """Tests for load_email_template function."""

    def test_loads_existing_template(self) -> None:
        """Test that existing template is loaded and formatted."""
        result = load_email_template("welcome", "Alice")

        # Template starts with "Hey," not "Hi {display_name},"
        assert "Hey," in result
        assert "Atlasi" in result

    def test_substitutes_display_name(self) -> None:
        """Test that display_name placeholder is replaced when present."""
        # Note: Current templates don't use {display_name}, but fallback does
        result = load_email_template("nonexistent", "Bob Smith")

        assert "Hi Bob Smith," in result  # Fallback format

    def test_handles_special_chars_in_display_name(self) -> None:
        """Test that special characters in display_name are handled."""
        # Test with fallback since current templates don't use placeholder
        result = load_email_template("nonexistent", "John {O'Brien}")

        assert "Hi John {O'Brien}," in result
        # Should not break the template

    def test_returns_fallback_for_missing_template(self) -> None:
        """Test that fallback message is used for missing template."""
        result = load_email_template("nonexistent_template", "Charlie")

        assert "Hi Charlie," in result
        assert "Welcome to Atlasi" in result

    def test_fallback_includes_display_name(self) -> None:
        """Test that fallback message includes the display_name."""
        result = load_email_template("does_not_exist", "Diana")

        assert "Hi Diana," in result

    def test_all_welcome_templates_exist(self) -> None:
        """Verify all configured welcome email templates exist."""
        for email_config in WELCOME_EMAILS:
            template_name = email_config["template"]
            template_path = TEMPLATES_DIR / f"{template_name}.txt"

            assert template_path.exists(), f"Missing template: {template_name}.txt"

    def test_all_templates_are_valid_text(self) -> None:
        """Verify all templates are valid text files."""
        for email_config in WELCOME_EMAILS:
            template_name = email_config["template"]
            template_path = TEMPLATES_DIR / f"{template_name}.txt"
            content = template_path.read_text()

            # All templates should have some content and end with Emerson
            assert len(content) > 50, f"Template {template_name}.txt is too short"
            assert (
                "Emerson" in content
            ), f"Template {template_name}.txt missing signature"

    def test_template_caching_works(self) -> None:
        """Test that templates are cached after first load."""
        # Clear the cache first
        _load_template_content.cache_clear()

        # Load template twice
        result1 = _load_template_content("welcome")
        result2 = _load_template_content("welcome")

        # Should return same content
        assert result1 == result2
        assert result1 is not None

        # Check cache info - should have 1 hit after second call
        cache_info = _load_template_content.cache_info()
        assert cache_info.hits == 1
        assert cache_info.misses == 1

    def test_cached_function_returns_none_for_missing(self) -> None:
        """Test that cached function returns None for missing templates."""
        _load_template_content.cache_clear()

        result = _load_template_content("definitely_not_a_template")
        assert result is None


class TestRedactEmail:
    """Tests for _redact_email function."""

    def test_returns_hash_prefix(self) -> None:
        """Test that email is hashed and truncated."""
        result = _redact_email("test@example.com")
        assert len(result) == 12
        assert result.isalnum()

    def test_consistent_hashing(self) -> None:
        """Test that same email always produces same hash."""
        email = "user@test.com"
        result1 = _redact_email(email)
        result2 = _redact_email(email)
        assert result1 == result2

    def test_different_emails_produce_different_hashes(self) -> None:
        """Test that different emails produce different hashes."""
        result1 = _redact_email("alice@example.com")
        result2 = _redact_email("bob@example.com")
        assert result1 != result2


class TestScheduleWelcomeEmails:
    """Tests for schedule_welcome_emails function."""

    @pytest.mark.asyncio
    async def test_returns_skipped_result_without_api_key(self) -> None:
        """Test that skipped result is returned when API key is not configured."""
        with patch("app.services.email.get_settings") as mock_settings:
            mock_settings.return_value.resend_api_key = ""

            result = await schedule_welcome_emails("test@example.com", "Test User")

            assert result.skipped is True
            assert result.email_ids == []
            assert result.total_attempted == 0

    @pytest.mark.asyncio
    async def test_logs_warning_without_api_key(self) -> None:
        """Test that warning is logged when API key is not configured."""
        with (
            patch("app.services.email.get_settings") as mock_settings,
            patch("app.services.email.logger") as mock_logger,
        ):
            mock_settings.return_value.resend_api_key = ""

            await schedule_welcome_emails("test@example.com", "Test User")

            mock_logger.warning.assert_called_once()
            assert "not configured" in mock_logger.warning.call_args[0][0]

    @pytest.mark.asyncio
    async def test_schedules_all_four_emails(self) -> None:
        """Test that all 4 welcome emails are scheduled."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"id": "email_123"}
        mock_response.raise_for_status = MagicMock()

        with (
            patch("app.services.email.get_settings") as mock_settings,
            patch("httpx.AsyncClient") as mock_client_class,
        ):
            mock_settings.return_value.resend_api_key = "re_test_key"
            mock_settings.return_value.welcome_email_from = "hello@test.com"

            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            result = await schedule_welcome_emails("test@example.com", "Test User")

            assert result.success_count == 4
            assert result.total_attempted == 4
            assert result.failed_count == 0
            assert mock_client.post.call_count == 4

    @pytest.mark.asyncio
    async def test_returns_email_ids(self) -> None:
        """Test that email IDs are returned for scheduled emails."""
        with (
            patch("app.services.email.get_settings") as mock_settings,
            patch("httpx.AsyncClient") as mock_client_class,
        ):
            mock_settings.return_value.resend_api_key = "re_test_key"
            mock_settings.return_value.welcome_email_from = "hello@test.com"

            # Create responses with different IDs
            responses = []
            for i in range(1, 5):
                mock_resp = MagicMock()
                mock_resp.json.return_value = {"id": f"email_{i}"}
                mock_resp.raise_for_status = MagicMock()
                responses.append(mock_resp)

            mock_client = AsyncMock()
            mock_client.post.side_effect = responses
            mock_client_class.return_value.__aenter__.return_value = mock_client

            result = await schedule_welcome_emails("test@example.com", "Test User")

            assert result.email_ids == [
                "email_1",
                "email_2",
                "email_3",
                "email_4",
            ]

    @pytest.mark.asyncio
    async def test_uses_correct_from_address(self) -> None:
        """Test that configured from address is used."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"id": "email_123"}
        mock_response.raise_for_status = MagicMock()

        with (
            patch("app.services.email.get_settings") as mock_settings,
            patch("httpx.AsyncClient") as mock_client_class,
        ):
            mock_settings.return_value.resend_api_key = "re_test_key"
            mock_settings.return_value.welcome_email_from = "noreply@atlasi.com"

            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            await schedule_welcome_emails("test@example.com", "Test User")

            # Check the from address in the first call
            call_args = mock_client.post.call_args_list[0]
            payload = call_args.kwargs["json"]
            assert payload["from"] == "noreply@atlasi.com"

    @pytest.mark.asyncio
    async def test_uses_correct_recipient(self) -> None:
        """Test that correct recipient email is used."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"id": "email_123"}
        mock_response.raise_for_status = MagicMock()

        with (
            patch("app.services.email.get_settings") as mock_settings,
            patch("httpx.AsyncClient") as mock_client_class,
        ):
            mock_settings.return_value.resend_api_key = "re_test_key"
            mock_settings.return_value.welcome_email_from = "hello@test.com"

            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            await schedule_welcome_emails("user@example.com", "Test User")

            call_args = mock_client.post.call_args_list[0]
            payload = call_args.kwargs["json"]
            assert payload["to"] == ["user@example.com"]

    @pytest.mark.asyncio
    async def test_includes_scheduled_at(self) -> None:
        """Test that scheduled_at is set for each email."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"id": "email_123"}
        mock_response.raise_for_status = MagicMock()

        with (
            patch("app.services.email.get_settings") as mock_settings,
            patch("httpx.AsyncClient") as mock_client_class,
        ):
            mock_settings.return_value.resend_api_key = "re_test_key"
            mock_settings.return_value.welcome_email_from = "hello@test.com"

            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            await schedule_welcome_emails("test@example.com", "Test User")

            for call in mock_client.post.call_args_list:
                payload = call.kwargs["json"]
                assert "scheduled_at" in payload
                # ISO format should include "T" separator
                assert "T" in payload["scheduled_at"]

    @pytest.mark.asyncio
    async def test_continues_on_single_email_failure(self) -> None:
        """Test that scheduling continues if one email fails."""
        with (
            patch("app.services.email.get_settings") as mock_settings,
            patch("httpx.AsyncClient") as mock_client_class,
            patch("app.services.email.logger") as mock_logger,
        ):
            mock_settings.return_value.resend_api_key = "re_test_key"
            mock_settings.return_value.welcome_email_from = "hello@test.com"

            # Create responses with one failure
            responses = []
            for i in range(1, 5):
                if i == 2:
                    # Fail on second email
                    responses.append(Exception("API error"))
                else:
                    mock_resp = MagicMock()
                    mock_resp.json.return_value = {"id": f"email_{i}"}
                    mock_resp.raise_for_status = MagicMock()
                    responses.append(mock_resp)

            mock_client = AsyncMock()
            mock_client.post.side_effect = responses
            mock_client_class.return_value.__aenter__.return_value = mock_client

            result = await schedule_welcome_emails("test@example.com", "Test User")

            # Should return 3 IDs (4 total minus 1 failure)
            assert result.success_count == 3
            assert result.failed_count == 1
            assert result.total_attempted == 4
            assert "email_1" in result.email_ids
            assert "email_3" in result.email_ids

            # Should log the error
            mock_logger.error.assert_called()

    @pytest.mark.asyncio
    async def test_logs_error_on_failure(self) -> None:
        """Test that errors are logged when email scheduling fails."""
        with (
            patch("app.services.email.get_settings") as mock_settings,
            patch("httpx.AsyncClient") as mock_client_class,
            patch("app.services.email.logger") as mock_logger,
        ):
            mock_settings.return_value.resend_api_key = "re_test_key"
            mock_settings.return_value.welcome_email_from = "hello@test.com"

            mock_client = AsyncMock()
            mock_client.post.side_effect = Exception("Network error")
            mock_client_class.return_value.__aenter__.return_value = mock_client

            await schedule_welcome_emails("test@example.com", "Test User")

            # Should log error for each failed email (4 failures)
            assert mock_logger.error.call_count == 4

    @pytest.mark.asyncio
    async def test_handles_http_status_error(self) -> None:
        """Test that HTTP status errors are handled properly."""
        with (
            patch("app.services.email.get_settings") as mock_settings,
            patch("httpx.AsyncClient") as mock_client_class,
            patch("app.services.email.logger") as mock_logger,
        ):
            mock_settings.return_value.resend_api_key = "re_test_key"
            mock_settings.return_value.welcome_email_from = "hello@test.com"

            # Create an HTTP error response
            mock_response = MagicMock()
            mock_response.status_code = 400
            http_error = httpx.HTTPStatusError(
                "Bad Request", request=MagicMock(), response=mock_response
            )

            mock_client = AsyncMock()
            mock_client.post.side_effect = http_error
            mock_client_class.return_value.__aenter__.return_value = mock_client

            await schedule_welcome_emails("test@example.com", "Test User")

            # Should log errors with status code
            assert mock_logger.error.call_count == 4
            # Check that status code is in extra dict
            call_extra = mock_logger.error.call_args_list[0].kwargs["extra"]
            assert call_extra["status_code"] == 400

    @pytest.mark.asyncio
    async def test_logs_use_redacted_email(self) -> None:
        """Test that logs use redacted email hash, not plaintext."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"id": "email_123"}
        mock_response.raise_for_status = MagicMock()

        with (
            patch("app.services.email.get_settings") as mock_settings,
            patch("httpx.AsyncClient") as mock_client_class,
            patch("app.services.email.logger") as mock_logger,
        ):
            mock_settings.return_value.resend_api_key = "re_test_key"
            mock_settings.return_value.welcome_email_from = "hello@test.com"

            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            await schedule_welcome_emails("secret@example.com", "Test User")

            # Check that info logs use recipient_hash not recipient
            for call in mock_logger.info.call_args_list:
                extra = call.kwargs.get("extra", {})
                assert "recipient" not in extra
                if "recipient_hash" in extra:
                    # Should be a hash, not the actual email
                    assert "secret@example.com" not in extra["recipient_hash"]
                    assert len(extra["recipient_hash"]) == 12

    @pytest.mark.asyncio
    async def test_uses_bearer_auth(self) -> None:
        """Test that API key is passed in Bearer auth header."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"id": "email_123"}
        mock_response.raise_for_status = MagicMock()

        with (
            patch("app.services.email.get_settings") as mock_settings,
            patch("httpx.AsyncClient") as mock_client_class,
        ):
            mock_settings.return_value.resend_api_key = "re_secret_key"
            mock_settings.return_value.welcome_email_from = "hello@test.com"

            mock_client = AsyncMock()
            mock_client.post.return_value = mock_response
            mock_client_class.return_value.__aenter__.return_value = mock_client

            await schedule_welcome_emails("test@example.com", "Test User")

            # Check that Bearer auth header is used
            call_args = mock_client.post.call_args_list[0]
            headers = call_args.kwargs["headers"]
            assert headers["Authorization"] == "Bearer re_secret_key"

    def test_email_delays_are_correct(self) -> None:
        """Test that email delay configuration is correct."""
        delays = [config["delay_hours"] for config in WELCOME_EMAILS]

        # Expected delays: immediately, day 2, day 4, day 7
        expected = [0, 24, 72, 144]
        assert delays == expected

    def test_email_subjects_are_configured(self) -> None:
        """Test that all emails have subject lines."""
        for config in WELCOME_EMAILS:
            assert "subject" in config
            assert len(config["subject"]) > 0
