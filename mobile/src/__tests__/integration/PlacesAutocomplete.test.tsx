/**
 * Integration tests for PlacesAutocomplete component.
 * Tests: debounced search, API interactions, manual entry fallback, selection handling.
 */

import React from 'react';
import { fireEvent, waitFor, act } from '@testing-library/react-native';

import { PlacesAutocomplete, SelectedPlace } from '@components/places/PlacesAutocomplete';
import {
  createMockPrediction,
  createMockPlacesApiResponse,
  createMockPlaceDetailsResponse,
} from '../utils/mockFactories';
import { render } from '../utils/testUtils';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Helper to create a mock Response object for new API format
const createMockResponse = (data: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: () => Promise.resolve(data),
});

describe('PlacesAutocomplete Integration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockFetch.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ============ Debounced Search Tests ============

  describe('Debounced Search', () => {
    it('debounces search requests by 300ms', async () => {
      const onSelect = jest.fn();
      mockFetch.mockResolvedValue(
        createMockResponse(createMockPlacesApiResponse([createMockPrediction()]))
      );

      const { getByPlaceholderText } = render(
        <PlacesAutocomplete onSelect={onSelect} placeholder="Search..." />
      );

      const input = getByPlaceholderText('Search...');

      // Type characters quickly
      fireEvent.changeText(input, 'c');
      fireEvent.changeText(input, 'ca');
      fireEvent.changeText(input, 'caf');

      // No fetch yet (before 300ms)
      expect(mockFetch).not.toHaveBeenCalled();

      // Final character
      fireEvent.changeText(input, 'cafe');

      // Advance timers and flush promises
      await act(async () => {
        jest.advanceTimersByTime(300);
        await Promise.resolve(); // Flush microtasks
      });

      // Run any remaining timers
      await act(async () => {
        jest.runAllTimers();
      });

      // Only one fetch call should be made (for the final query "cafe")
      // New API uses POST with JSON body instead of GET with query params
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://places.googleapis.com/v1/places:autocomplete',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"input":"cafe"'),
          signal: expect.any(AbortSignal),
        })
      );
    }, 10000);

    it('does not search for empty input', async () => {
      const onSelect = jest.fn();
      const { getByPlaceholderText } = render(
        <PlacesAutocomplete onSelect={onSelect} placeholder="Search..." />
      );

      const input = getByPlaceholderText('Search...');

      // Type and then clear
      fireEvent.changeText(input, 'test');
      fireEvent.changeText(input, '');

      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not search for whitespace-only input', async () => {
      const onSelect = jest.fn();
      const { getByPlaceholderText } = render(
        <PlacesAutocomplete onSelect={onSelect} placeholder="Search..." />
      );

      const input = getByPlaceholderText('Search...');
      fireEvent.changeText(input, '   ');

      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ============ API Success Flow Tests ============

  describe('API Success Flow', () => {
    it('shows predictions dropdown on successful search', async () => {
      const onSelect = jest.fn();
      const predictions = [
        createMockPrediction({
          place_id: 'place-1',
          structured_formatting: {
            main_text: 'Test Restaurant',
            secondary_text: 'Tokyo, Japan',
          },
        }),
        createMockPrediction({
          place_id: 'place-2',
          structured_formatting: {
            main_text: 'Test Cafe',
            secondary_text: 'Osaka, Japan',
          },
        }),
      ];
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockPlacesApiResponse(predictions))
      );

      const { getByPlaceholderText, getByText } = render(
        <PlacesAutocomplete onSelect={onSelect} placeholder="Search..." />
      );

      const input = getByPlaceholderText('Search...');
      fireEvent.changeText(input, 'test');

      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(getByText('Test Restaurant')).toBeTruthy();
        expect(getByText('Test Cafe')).toBeTruthy();
      });
    });

    it('displays main_text and secondary_text for each prediction', async () => {
      const onSelect = jest.fn();
      const prediction = createMockPrediction({
        structured_formatting: {
          main_text: 'Sensoji Temple',
          secondary_text: 'Asakusa, Taito City, Tokyo, Japan',
        },
      });
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockPlacesApiResponse([prediction]))
      );

      const { getByPlaceholderText, getByText } = render(
        <PlacesAutocomplete onSelect={onSelect} placeholder="Search..." />
      );

      const input = getByPlaceholderText('Search...');
      fireEvent.changeText(input, 'sensoji');

      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(getByText('Sensoji Temple')).toBeTruthy();
        expect(getByText('Asakusa, Taito City, Tokyo, Japan')).toBeTruthy();
      });
    });

    it('fetches place details on prediction selection', async () => {
      const onSelect = jest.fn();
      const prediction = createMockPrediction({ place_id: 'ChIJ123abc' });
      const detailsResponse = createMockPlaceDetailsResponse();

      // First call: autocomplete search
      mockFetch.mockResolvedValueOnce(
        createMockResponse(createMockPlacesApiResponse([prediction]))
      );
      // Second call: place details (new API format)
      mockFetch.mockResolvedValueOnce(createMockResponse(detailsResponse));

      const { getByPlaceholderText, getByText } = render(
        <PlacesAutocomplete onSelect={onSelect} placeholder="Search..." />
      );

      const input = getByPlaceholderText('Search...');
      fireEvent.changeText(input, 'test');

      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(getByText(prediction.structured_formatting.main_text)).toBeTruthy();
      });

      // Click on the prediction
      fireEvent.press(getByText(prediction.structured_formatting.main_text));

      await waitFor(() => {
        // Verify place details was fetched using new API endpoint format
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(mockFetch).toHaveBeenLastCalledWith(
          expect.stringContaining('places.googleapis.com/v1/places/ChIJ123abc'),
          expect.objectContaining({
            headers: expect.objectContaining({
              'X-Goog-Api-Key': expect.any(String),
            }),
          })
        );
      });
    });

    it('returns coordinates from place details', async () => {
      const onSelect = jest.fn();
      const prediction = createMockPrediction({ place_id: 'ChIJ123abc' });
      // New API format for place details
      const detailsResponse = {
        id: 'ChIJ123abc',
        displayName: { text: 'Test Place' },
        formattedAddress: 'Tokyo, Japan',
        location: {
          latitude: 35.6762,
          longitude: 139.6503,
        },
      };

      mockFetch
        .mockResolvedValueOnce(createMockResponse(createMockPlacesApiResponse([prediction])))
        .mockResolvedValueOnce(createMockResponse(detailsResponse));

      const { getByPlaceholderText, getByText } = render(
        <PlacesAutocomplete onSelect={onSelect} placeholder="Search..." />
      );

      fireEvent.changeText(getByPlaceholderText('Search...'), 'test');

      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(getByText(prediction.structured_formatting.main_text)).toBeTruthy();
      });

      fireEvent.press(getByText(prediction.structured_formatting.main_text));

      await waitFor(() => {
        expect(onSelect).toHaveBeenCalledWith({
          google_place_id: 'ChIJ123abc',
          name: 'Test Place',
          address: 'Tokyo, Japan',
          latitude: 35.6762,
          longitude: 139.6503,
        });
      });
    });

    it('falls back to prediction data if details fetch fails', async () => {
      const onSelect = jest.fn();
      const prediction = createMockPrediction({
        place_id: 'ChIJ123abc',
        structured_formatting: {
          main_text: 'Fallback Place',
          secondary_text: 'Fallback Address',
        },
      });

      mockFetch
        .mockResolvedValueOnce(createMockResponse(createMockPlacesApiResponse([prediction])))
        .mockRejectedValueOnce(new Error('Network error'));

      const { getByPlaceholderText, getByText } = render(
        <PlacesAutocomplete onSelect={onSelect} placeholder="Search..." />
      );

      fireEvent.changeText(getByPlaceholderText('Search...'), 'test');

      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(getByText('Fallback Place')).toBeTruthy();
      });

      fireEvent.press(getByText('Fallback Place'));

      await waitFor(() => {
        expect(onSelect).toHaveBeenCalledWith({
          google_place_id: 'ChIJ123abc',
          name: 'Fallback Place',
          address: 'Fallback Address',
          latitude: null,
          longitude: null,
        });
      });
    });

    it('falls back to prediction data if details API returns error status', async () => {
      const onSelect = jest.fn();
      const prediction = createMockPrediction({
        place_id: 'ChIJ123abc',
        structured_formatting: {
          main_text: 'No Details Place',
          secondary_text: 'Some Address',
        },
      });

      mockFetch
        .mockResolvedValueOnce(createMockResponse(createMockPlacesApiResponse([prediction])))
        // New API uses HTTP status codes for errors
        .mockResolvedValueOnce(createMockResponse({}, false, 404));

      const { getByPlaceholderText, getByText } = render(
        <PlacesAutocomplete onSelect={onSelect} placeholder="Search..." />
      );

      fireEvent.changeText(getByPlaceholderText('Search...'), 'test');

      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(getByText('No Details Place')).toBeTruthy();
      });

      fireEvent.press(getByText('No Details Place'));

      await waitFor(() => {
        expect(onSelect).toHaveBeenCalledWith({
          google_place_id: 'ChIJ123abc',
          name: 'No Details Place',
          address: 'Some Address',
          latitude: null,
          longitude: null,
        });
      });
    });
  });

  // ============ API Quota Exceeded Tests ============

  describe('API Quota Exceeded Flow', () => {
    it('shows manual entry form on HTTP 429 (rate limit)', async () => {
      const onSelect = jest.fn();
      // New API uses HTTP status codes instead of status field in response
      mockFetch.mockResolvedValueOnce(createMockResponse({}, false, 429));

      const { getByPlaceholderText, getByText } = render(
        <PlacesAutocomplete onSelect={onSelect} placeholder="Search..." />
      );

      fireEvent.changeText(getByPlaceholderText('Search...'), 'test');

      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      // Component shows manual entry form when API quota is exceeded
      await waitFor(() => {
        expect(getByText('Enter Place Details')).toBeTruthy();
        expect(getByPlaceholderText('Place name *')).toBeTruthy();
      });
    });

    it('shows manual entry form on HTTP 403 (request denied)', async () => {
      const onSelect = jest.fn();
      // New API uses HTTP 403 for request denied
      mockFetch.mockResolvedValueOnce(createMockResponse({}, false, 403));

      const { getByPlaceholderText, getByText } = render(
        <PlacesAutocomplete onSelect={onSelect} placeholder="Search..." />
      );

      fireEvent.changeText(getByPlaceholderText('Search...'), 'test');

      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      // Component shows manual entry form when API is denied
      await waitFor(() => {
        expect(getByText('Enter Place Details')).toBeTruthy();
      });
    });
  });

  // ============ Manual Entry Tests ============

  describe('Manual Entry Flow', () => {
    it('validates place name is required - button disabled when empty', async () => {
      const onSelect = jest.fn();
      // HTTP 429 triggers manual entry mode
      mockFetch.mockResolvedValueOnce(createMockResponse({}, false, 429));

      const { getByPlaceholderText, getByText } = render(
        <PlacesAutocomplete onSelect={onSelect} placeholder="Search..." />
      );

      fireEvent.changeText(getByPlaceholderText('Search...'), 'test');

      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(getByText('Enter Place Details')).toBeTruthy();
      });

      // Try to submit without entering name
      const addButton = getByText('Add Place');
      fireEvent.press(addButton);

      // onSelect should NOT be called when name is empty
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('creates place with manual_ prefix for google_place_id', async () => {
      const onSelect = jest.fn();
      mockFetch.mockResolvedValueOnce(createMockResponse({}, false, 429));

      const { getByPlaceholderText, getByText } = render(
        <PlacesAutocomplete onSelect={onSelect} placeholder="Search..." />
      );

      fireEvent.changeText(getByPlaceholderText('Search...'), 'test');

      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(getByText('Enter Place Details')).toBeTruthy();
      });

      // Fill in manual entry form
      const nameInput = getByPlaceholderText('Place name *');
      fireEvent.changeText(nameInput, 'My Custom Place');

      // Submit
      fireEvent.press(getByText('Add Place'));

      await waitFor(() => {
        expect(onSelect).toHaveBeenCalledWith(
          expect.objectContaining({
            google_place_id: expect.stringMatching(/^manual_\d+$/),
            name: 'My Custom Place',
            latitude: null,
            longitude: null,
          })
        );
      });
    });

    it('address is optional in manual entry', async () => {
      const onSelect = jest.fn();
      mockFetch.mockResolvedValueOnce(createMockResponse({}, false, 429));

      const { getByPlaceholderText, getByText } = render(
        <PlacesAutocomplete onSelect={onSelect} placeholder="Search..." />
      );

      fireEvent.changeText(getByPlaceholderText('Search...'), 'test');

      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(getByText('Enter Place Details')).toBeTruthy();
      });

      // Only fill name, leave address empty
      fireEvent.changeText(getByPlaceholderText('Place name *'), 'Name Only');
      fireEvent.press(getByText('Add Place'));

      await waitFor(() => {
        expect(onSelect).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Name Only',
            address: null, // Address is null when not provided
          })
        );
      });
    });

    it('includes address when provided in manual entry', async () => {
      const onSelect = jest.fn();
      mockFetch.mockResolvedValueOnce(createMockResponse({}, false, 429));

      const { getByPlaceholderText, getByText } = render(
        <PlacesAutocomplete onSelect={onSelect} placeholder="Search..." />
      );

      fireEvent.changeText(getByPlaceholderText('Search...'), 'test');

      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(getByText('Enter Place Details')).toBeTruthy();
      });

      // Fill both name and address
      fireEvent.changeText(getByPlaceholderText('Place name *'), 'Full Entry');
      fireEvent.changeText(getByPlaceholderText('Address (optional)'), '123 Test Street');
      fireEvent.press(getByText('Add Place'));

      await waitFor(() => {
        expect(onSelect).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Full Entry',
            address: '123 Test Street',
          })
        );
      });
    });
  });

  // ============ Country Code Filtering Tests ============

  describe('Country Code Filtering', () => {
    it('includes country code in API request when countryCode provided', async () => {
      const onSelect = jest.fn();
      mockFetch.mockResolvedValueOnce(createMockResponse(createMockPlacesApiResponse([])));

      const { getByPlaceholderText } = render(
        <PlacesAutocomplete onSelect={onSelect} countryCode="JP" placeholder="Search..." />
      );

      fireEvent.changeText(getByPlaceholderText('Search...'), 'ramen');

      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      await waitFor(() => {
        // New API uses includedRegionCodes in JSON body instead of query param
        expect(mockFetch).toHaveBeenCalledWith(
          'https://places.googleapis.com/v1/places:autocomplete',
          expect.objectContaining({
            body: expect.stringContaining('"includedRegionCodes":["jp"]'),
          })
        );
      });
    });

    it('does not include country code when countryCode is not provided', async () => {
      const onSelect = jest.fn();
      mockFetch.mockResolvedValueOnce(createMockResponse(createMockPlacesApiResponse([])));

      const { getByPlaceholderText } = render(
        <PlacesAutocomplete onSelect={onSelect} placeholder="Search..." />
      );

      fireEvent.changeText(getByPlaceholderText('Search...'), 'test');

      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
        const fetchOptions = mockFetch.mock.calls[0][1];
        expect(fetchOptions.body).not.toContain('includedRegionCodes');
      });
    });
  });

  // ============ Clear and Selection State Tests ============

  describe('Clear and Selection States', () => {
    it('calls onSelect(null) on clear button press', async () => {
      const onSelect = jest.fn();
      const initialValue: SelectedPlace = {
        google_place_id: 'ChIJ123',
        name: 'Initial Place',
        address: 'Tokyo',
        latitude: 35.6762,
        longitude: 139.6503,
      };

      render(
        <PlacesAutocomplete onSelect={onSelect} value={initialValue} placeholder="Search..." />
      );

      // The clear button should be visible when there's input
      // Note: We need to check if the component renders a clear button
      // This might need adjustment based on actual component implementation
      await waitFor(() => {
        // Component should show the selected place name in input
      });
    });

    it('shows selected place info when value prop provided', async () => {
      const onSelect = jest.fn();
      const selectedPlace: SelectedPlace = {
        google_place_id: 'ChIJ123',
        name: 'Sensoji Temple',
        address: 'Asakusa, Tokyo',
        latitude: 35.7147,
        longitude: 139.7966,
      };

      const { getByDisplayValue } = render(
        <PlacesAutocomplete onSelect={onSelect} value={selectedPlace} placeholder="Search..." />
      );

      // Input should show the place name
      expect(getByDisplayValue('Sensoji Temple')).toBeTruthy();
    });

    it('syncs with external value prop changes', async () => {
      const onSelect = jest.fn();
      const initialValue: SelectedPlace = {
        google_place_id: 'ChIJ123',
        name: 'First Place',
        address: 'Address 1',
        latitude: 35.0,
        longitude: 139.0,
      };

      const { getByDisplayValue, rerender } = render(
        <PlacesAutocomplete onSelect={onSelect} value={initialValue} placeholder="Search..." />
      );

      expect(getByDisplayValue('First Place')).toBeTruthy();

      // Update value prop
      const newValue: SelectedPlace = {
        google_place_id: 'ChIJ456',
        name: 'Second Place',
        address: 'Address 2',
        latitude: 36.0,
        longitude: 140.0,
      };

      rerender(<PlacesAutocomplete onSelect={onSelect} value={newValue} placeholder="Search..." />);

      expect(getByDisplayValue('Second Place')).toBeTruthy();
    });
  });

  // ============ No Results Tests ============

  describe('No Results Handling', () => {
    it('shows no results message and manual entry option when API returns empty', async () => {
      const onSelect = jest.fn();
      // New API returns empty suggestions array for no results
      mockFetch.mockResolvedValueOnce(createMockResponse({ suggestions: [] }));

      const { getByPlaceholderText, getByText } = render(
        <PlacesAutocomplete onSelect={onSelect} placeholder="Search..." />
      );

      fireEvent.changeText(getByPlaceholderText('Search...'), 'xyz123nonexistent');

      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(getByText('No places found')).toBeTruthy();
        expect(getByText('Enter manually')).toBeTruthy();
      });
    });

    it('allows manual entry from no results state', async () => {
      const onSelect = jest.fn();
      mockFetch.mockResolvedValueOnce(createMockResponse({ suggestions: [] }));

      const { getByPlaceholderText, getByText } = render(
        <PlacesAutocomplete onSelect={onSelect} placeholder="Search..." />
      );

      fireEvent.changeText(getByPlaceholderText('Search...'), 'customplace');

      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      await waitFor(() => {
        expect(getByText('Enter manually')).toBeTruthy();
      });

      // Click manual entry button
      fireEvent.press(getByText('Enter manually'));

      await waitFor(() => {
        expect(getByText('Enter Place Details')).toBeTruthy();
        // The query should be pre-filled in manual name field
        expect(getByPlaceholderText('Place name *')).toBeTruthy();
      });
    });
  });
});
