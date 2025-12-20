/**
 * Tests for clipboard URL detection logic.
 *
 * Focuses on the pure function `detectSocialUrl` which doesn't require
 * React Native runtime or clipboard access.
 */

import { detectSocialUrl } from '@hooks/useClipboardListener';

describe('detectSocialUrl', () => {
  describe('TikTok URLs', () => {
    it('detects standard TikTok video URLs', () => {
      const result = detectSocialUrl('https://www.tiktok.com/@user/video/1234567890');
      expect(result).toEqual({
        url: 'https://www.tiktok.com/@user/video/1234567890',
        provider: 'tiktok',
      });
    });

    it('detects TikTok URLs without www', () => {
      const result = detectSocialUrl('https://tiktok.com/@user/video/1234567890');
      expect(result).toEqual({
        url: 'https://tiktok.com/@user/video/1234567890',
        provider: 'tiktok',
      });
    });

    it('detects vm.tiktok.com short URLs', () => {
      const result = detectSocialUrl('https://vm.tiktok.com/ABC123xyz/');
      expect(result).toEqual({
        url: 'https://vm.tiktok.com/ABC123xyz/',
        provider: 'tiktok',
      });
    });

    it('detects vt.tiktok.com short URLs', () => {
      const result = detectSocialUrl('https://vt.tiktok.com/ZSxxxxxxxx/');
      expect(result).toEqual({
        url: 'https://vt.tiktok.com/ZSxxxxxxxx/',
        provider: 'tiktok',
      });
    });

    it('detects TikTok URLs with http (not https)', () => {
      const result = detectSocialUrl('http://www.tiktok.com/@user/video/123');
      expect(result).toEqual({
        url: 'http://www.tiktok.com/@user/video/123',
        provider: 'tiktok',
      });
    });

    it('handles TikTok URLs with query parameters', () => {
      const url = 'https://www.tiktok.com/@user/video/123?is_from_webapp=1&sender_device=pc';
      const result = detectSocialUrl(url);
      expect(result).toEqual({
        url,
        provider: 'tiktok',
      });
    });
  });

  describe('Instagram URLs', () => {
    it('detects Instagram post URLs', () => {
      const result = detectSocialUrl('https://www.instagram.com/p/ABC123xyz/');
      expect(result).toEqual({
        url: 'https://www.instagram.com/p/ABC123xyz/',
        provider: 'instagram',
      });
    });

    it('detects Instagram reel URLs', () => {
      const result = detectSocialUrl('https://www.instagram.com/reel/ABC123xyz/');
      expect(result).toEqual({
        url: 'https://www.instagram.com/reel/ABC123xyz/',
        provider: 'instagram',
      });
    });

    it('detects Instagram reels URLs (plural)', () => {
      const result = detectSocialUrl('https://www.instagram.com/reels/ABC123xyz/');
      expect(result).toEqual({
        url: 'https://www.instagram.com/reels/ABC123xyz/',
        provider: 'instagram',
      });
    });

    it('detects Instagram URLs without www', () => {
      const result = detectSocialUrl('https://instagram.com/p/ABC123xyz/');
      expect(result).toEqual({
        url: 'https://instagram.com/p/ABC123xyz/',
        provider: 'instagram',
      });
    });

    it('detects instagr.am short URLs', () => {
      const result = detectSocialUrl('https://instagr.am/p/ABC123xyz/');
      expect(result).toEqual({
        url: 'https://instagr.am/p/ABC123xyz/',
        provider: 'instagram',
      });
    });

    it('handles Instagram URLs with query parameters', () => {
      const url = 'https://www.instagram.com/reel/ABC123/?igsh=xyz123';
      const result = detectSocialUrl(url);
      expect(result).toEqual({
        url,
        provider: 'instagram',
      });
    });
  });

  describe('Non-matching URLs', () => {
    it('returns null for regular URLs', () => {
      expect(detectSocialUrl('https://www.google.com')).toBeNull();
      expect(detectSocialUrl('https://example.com/video')).toBeNull();
    });

    it('returns null for Instagram profile URLs (not posts/reels)', () => {
      // Profile pages are not shareable place content
      expect(detectSocialUrl('https://www.instagram.com/username')).toBeNull();
      expect(detectSocialUrl('https://www.instagram.com/username/')).toBeNull();
    });

    it('returns null for YouTube URLs', () => {
      expect(detectSocialUrl('https://www.youtube.com/watch?v=abc123')).toBeNull();
      expect(detectSocialUrl('https://youtu.be/abc123')).toBeNull();
    });

    it('returns null for Twitter/X URLs', () => {
      expect(detectSocialUrl('https://twitter.com/user/status/123')).toBeNull();
      expect(detectSocialUrl('https://x.com/user/status/123')).toBeNull();
    });

    it('returns null for empty or null input', () => {
      expect(detectSocialUrl(null)).toBeNull();
      expect(detectSocialUrl('')).toBeNull();
      expect(detectSocialUrl('   ')).toBeNull();
    });

    it('returns null for plain text', () => {
      expect(detectSocialUrl('Check out this cool place!')).toBeNull();
      expect(detectSocialUrl('tiktok video about travel')).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('trims whitespace from URLs', () => {
      const result = detectSocialUrl('  https://www.tiktok.com/@user/video/123  ');
      expect(result).toEqual({
        url: 'https://www.tiktok.com/@user/video/123',
        provider: 'tiktok',
      });
    });

    it('handles mixed case URLs', () => {
      const result = detectSocialUrl('HTTPS://WWW.TIKTOK.COM/@user/video/123');
      expect(result).toEqual({
        url: 'HTTPS://WWW.TIKTOK.COM/@user/video/123',
        provider: 'tiktok',
      });
    });

    it('does not match URLs embedded in text', () => {
      // The function expects a single URL, not text with URLs
      expect(
        detectSocialUrl('Check out https://www.tiktok.com/@user/video/123 amazing!')
      ).toBeNull();
    });
  });
});
