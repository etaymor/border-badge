"""Tests for email service functionality."""

from unittest.mock import patch

from app.services.email import (
    TEMPLATES_DIR,
    WELCOME_EMAILS,
    _load_template_content,
    load_email_template,
    schedule_welcome_emails,
)


class TestLoadEmailTemplate:
    """Tests for load_email_template function."""

    def test_loads_existing_template(self) -> None:
        """Test that existing template is loaded and formatted."""
        result = load_email_template("welcome", "Alice")

        assert "Hi Alice," in result
        assert "Welcome to Atlasi" in result
        assert "{display_name}" not in result  # Should be replaced

    def test_substitutes_display_name(self) -> None:
        """Test that display_name placeholder is replaced."""
        result = load_email_template("welcome", "Bob Smith")

        assert "Hi Bob Smith," in result
        assert "{display_name}" not in result

    def test_handles_special_chars_in_display_name(self) -> None:
        """Test that special characters in display_name are handled."""
        result = load_email_template("welcome", "John {O'Brien}")

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

    def test_all_templates_have_display_name_placeholder(self) -> None:
        """Verify all templates use the display_name placeholder."""
        for email_config in WELCOME_EMAILS:
            template_name = email_config["template"]
            template_path = TEMPLATES_DIR / f"{template_name}.txt"
            content = template_path.read_text()

            assert (
                "{display_name}" in content
            ), f"Template {template_name}.txt missing {{display_name}} placeholder"

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


class TestScheduleWelcomeEmails:
    """Tests for schedule_welcome_emails function."""

    def test_returns_empty_list_without_api_key(self) -> None:
        """Test that empty list is returned when API key is not configured."""
        with patch("app.services.email.get_settings") as mock_settings:
            mock_settings.return_value.resend_api_key = None

            result = schedule_welcome_emails("test@example.com", "Test User")

            assert result == []

    def test_logs_warning_without_api_key(self) -> None:
        """Test that warning is logged when API key is not configured."""
        with (
            patch("app.services.email.get_settings") as mock_settings,
            patch("app.services.email.logger") as mock_logger,
        ):
            mock_settings.return_value.resend_api_key = None

            schedule_welcome_emails("test@example.com", "Test User")

            mock_logger.warning.assert_called_once()
            assert "not configured" in mock_logger.warning.call_args[0][0]

    def test_schedules_all_five_emails(self) -> None:
        """Test that all 5 welcome emails are scheduled."""
        with (
            patch("app.services.email.get_settings") as mock_settings,
            patch("app.services.email.resend") as mock_resend,
        ):
            mock_settings.return_value.resend_api_key = "re_test_key"
            mock_settings.return_value.welcome_email_from = "hello@test.com"

            mock_resend.Emails.send.return_value = {"id": "email_123"}

            result = schedule_welcome_emails("test@example.com", "Test User")

            assert len(result) == 5
            assert mock_resend.Emails.send.call_count == 5

    def test_returns_email_ids(self) -> None:
        """Test that email IDs are returned for scheduled emails."""
        with (
            patch("app.services.email.get_settings") as mock_settings,
            patch("app.services.email.resend") as mock_resend,
        ):
            mock_settings.return_value.resend_api_key = "re_test_key"
            mock_settings.return_value.welcome_email_from = "hello@test.com"

            # Return different IDs for each email
            mock_resend.Emails.send.side_effect = [
                {"id": "email_1"},
                {"id": "email_2"},
                {"id": "email_3"},
                {"id": "email_4"},
                {"id": "email_5"},
            ]

            result = schedule_welcome_emails("test@example.com", "Test User")

            assert result == ["email_1", "email_2", "email_3", "email_4", "email_5"]

    def test_uses_correct_from_address(self) -> None:
        """Test that configured from address is used."""
        with (
            patch("app.services.email.get_settings") as mock_settings,
            patch("app.services.email.resend") as mock_resend,
        ):
            mock_settings.return_value.resend_api_key = "re_test_key"
            mock_settings.return_value.welcome_email_from = "noreply@atlasi.com"
            mock_resend.Emails.send.return_value = {"id": "email_123"}

            schedule_welcome_emails("test@example.com", "Test User")

            # Check the from address in the first call
            call_args = mock_resend.Emails.send.call_args_list[0]
            params = call_args[0][0]  # First positional argument
            assert params["from"] == "noreply@atlasi.com"

    def test_uses_correct_recipient(self) -> None:
        """Test that correct recipient email is used."""
        with (
            patch("app.services.email.get_settings") as mock_settings,
            patch("app.services.email.resend") as mock_resend,
        ):
            mock_settings.return_value.resend_api_key = "re_test_key"
            mock_settings.return_value.welcome_email_from = "hello@test.com"
            mock_resend.Emails.send.return_value = {"id": "email_123"}

            schedule_welcome_emails("user@example.com", "Test User")

            call_args = mock_resend.Emails.send.call_args_list[0]
            params = call_args[0][0]
            assert params["to"] == ["user@example.com"]

    def test_includes_scheduled_at(self) -> None:
        """Test that scheduled_at is set for each email."""
        with (
            patch("app.services.email.get_settings") as mock_settings,
            patch("app.services.email.resend") as mock_resend,
        ):
            mock_settings.return_value.resend_api_key = "re_test_key"
            mock_settings.return_value.welcome_email_from = "hello@test.com"
            mock_resend.Emails.send.return_value = {"id": "email_123"}

            schedule_welcome_emails("test@example.com", "Test User")

            for call in mock_resend.Emails.send.call_args_list:
                params = call[0][0]
                assert "scheduled_at" in params
                # ISO format should include "T" separator
                assert "T" in params["scheduled_at"]

    def test_continues_on_single_email_failure(self) -> None:
        """Test that scheduling continues if one email fails."""
        with (
            patch("app.services.email.get_settings") as mock_settings,
            patch("app.services.email.resend") as mock_resend,
            patch("app.services.email.logger") as mock_logger,
        ):
            mock_settings.return_value.resend_api_key = "re_test_key"
            mock_settings.return_value.welcome_email_from = "hello@test.com"

            # Fail on second email
            mock_resend.Emails.send.side_effect = [
                {"id": "email_1"},
                Exception("API error"),
                {"id": "email_3"},
                {"id": "email_4"},
                {"id": "email_5"},
            ]

            result = schedule_welcome_emails("test@example.com", "Test User")

            # Should return 4 IDs (5 total minus 1 failure)
            assert len(result) == 4
            assert "email_1" in result
            assert "email_3" in result

            # Should log the error
            mock_logger.error.assert_called()

    def test_logs_error_on_failure(self) -> None:
        """Test that errors are logged when email scheduling fails."""
        with (
            patch("app.services.email.get_settings") as mock_settings,
            patch("app.services.email.resend") as mock_resend,
            patch("app.services.email.logger") as mock_logger,
        ):
            mock_settings.return_value.resend_api_key = "re_test_key"
            mock_settings.return_value.welcome_email_from = "hello@test.com"
            mock_resend.Emails.send.side_effect = Exception("Network error")

            schedule_welcome_emails("test@example.com", "Test User")

            # Should log error for each failed email (5 failures)
            assert mock_logger.error.call_count == 5

    def test_email_delays_are_correct(self) -> None:
        """Test that email delay configuration is correct."""
        delays = [config["delay_hours"] for config in WELCOME_EMAILS]

        # Expected delays: 2 hours, 3 days, 1 week, 2 weeks, 30 days
        expected = [2, 72, 168, 336, 720]
        assert delays == expected

    def test_email_subjects_are_configured(self) -> None:
        """Test that all emails have subject lines."""
        for config in WELCOME_EMAILS:
            assert "subject" in config
            assert len(config["subject"]) > 0

    def test_sets_resend_api_key(self) -> None:
        """Test that Resend API key is set before sending."""
        with (
            patch("app.services.email.get_settings") as mock_settings,
            patch("app.services.email.resend") as mock_resend,
        ):
            mock_settings.return_value.resend_api_key = "re_secret_key"
            mock_settings.return_value.welcome_email_from = "hello@test.com"
            mock_resend.Emails.send.return_value = {"id": "email_123"}

            schedule_welcome_emails("test@example.com", "Test User")

            assert mock_resend.api_key == "re_secret_key"
