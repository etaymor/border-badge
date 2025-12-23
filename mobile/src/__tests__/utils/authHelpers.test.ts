/**
 * Tests for authHelpers utility functions.
 */

import { hasUserOnboarded } from '@utils/authHelpers';
import { supabase } from '@services/supabase';

// Mock supabase
const mockSupabaseFrom = supabase.from as jest.Mock;

describe('authHelpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('hasUserOnboarded', () => {
    it('returns true when user has country data', async () => {
      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: [{ id: 'country-1' }],
          error: null,
        }),
      });

      const result = await hasUserOnboarded('user-123');
      expect(result).toBe(true);
    });

    it('returns false when user has no country data', async () => {
      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
      });

      const result = await hasUserOnboarded('user-123');
      expect(result).toBe(false);
    });

    it('returns false when data is null', async () => {
      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      });

      const result = await hasUserOnboarded('user-123');
      expect(result).toBe(false);
    });

    it('returns false on error (fallback to migration)', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockRejectedValue(new Error('Network error')),
      });

      const result = await hasUserOnboarded('user-123');
      expect(result).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith('Failed to check onboarding status');

      consoleWarnSpy.mockRestore();
    });

    it('queries user_countries table with correct user ID', async () => {
      const mockSelect = jest.fn().mockReturnThis();
      const mockEq = jest.fn().mockReturnThis();
      const mockLimit = jest.fn().mockResolvedValue({ data: [], error: null });

      mockSupabaseFrom.mockReturnValue({
        select: mockSelect,
        eq: mockEq,
        limit: mockLimit,
      });

      await hasUserOnboarded('test-user-id');

      expect(mockSupabaseFrom).toHaveBeenCalledWith('user_countries');
      expect(mockSelect).toHaveBeenCalledWith('id');
      expect(mockEq).toHaveBeenCalledWith('user_id', 'test-user-id');
      expect(mockLimit).toHaveBeenCalledWith(1);
    });
  });
});
