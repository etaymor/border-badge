/**
 * The trips cross-sell, and the rules that keep it from taxing the Guess Where
 * user who never asked for trips.
 *
 * The product concern this row exists under is specific: a scan sold as the
 * price of a challenge must not turn into a pitch for a different feature. So
 * the row is silent unless trips actually exist, dismissible forever, and
 * phrased as work already done.
 */

jest.mock('@services/photoImport/photoCacheDb', () => ({
  getMetadata: jest.fn(),
  setMetadata: jest.fn(),
}));

jest.mock('@services/quiz/quizTripContinuation', () => ({
  countUnreviewedTripSegments: jest.fn(),
}));

jest.mock('@hooks/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { SCAN_COPY } from '@constants/scanCopy';
import { getMetadata, setMetadata } from '@services/photoImport/photoCacheDb';
import { countUnreviewedTripSegments } from '@services/quiz/quizTripContinuation';
import { TripCrossSellRow } from '@screens/quiz/components/TripCrossSellRow';

const mockGetMetadata = getMetadata as jest.Mock;
const mockSetMetadata = setMetadata as jest.Mock;
const mockCountSegments = countUnreviewedTripSegments as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetMetadata.mockResolvedValue(null);
  mockSetMetadata.mockResolvedValue(undefined);
  mockCountSegments.mockResolvedValue(4);
});

describe('TripCrossSellRow', () => {
  it('offers the trips the scan already produced, as work already done', async () => {
    render(<TripCrossSellRow onReviewTrips={jest.fn()} testID="row" />);

    await waitFor(() => expect(screen.getByTestId('row')).toBeTruthy());
    expect(screen.getByText(SCAN_COPY.quiz.crossSell(4))).toBeTruthy();
    // Past tense, about the scan — never "we can also build your trips".
    expect(screen.getByText(SCAN_COPY.quiz.crossSell(4)).props.children).toMatch(/also turned up/);
  });

  it('stays silent when segmentation produced nothing', async () => {
    mockCountSegments.mockResolvedValue(0);

    render(<TripCrossSellRow onReviewTrips={jest.fn()} testID="row" />);

    // Never a speculative pitch: no trips, no row.
    await waitFor(() => expect(mockCountSegments).toHaveBeenCalled());
    expect(screen.queryByTestId('row')).toBeNull();
  });

  it('stays silent forever once dismissed', async () => {
    mockGetMetadata.mockResolvedValue('1700000000000');

    render(<TripCrossSellRow onReviewTrips={jest.fn()} testID="row" />);

    await waitFor(() => expect(mockGetMetadata).toHaveBeenCalled());
    expect(screen.queryByTestId('row')).toBeNull();
    // It never even asks how many trips there are.
    expect(mockCountSegments).not.toHaveBeenCalled();
  });

  it('persists the dismissal rather than only hiding for this mount', async () => {
    render(<TripCrossSellRow onReviewTrips={jest.fn()} testID="row" />);
    await waitFor(() => expect(screen.getByTestId('row')).toBeTruthy());

    fireEvent.press(screen.getByTestId('quiz-crosssell-dismiss'));

    expect(screen.queryByTestId('row')).toBeNull();
    expect(mockSetMetadata).toHaveBeenCalledWith(
      'quiz_trip_crosssell_dismissed_at',
      expect.any(String)
    );
  });

  it('hands review off to the caller, which opens suggestions without a rescan', async () => {
    const onReviewTrips = jest.fn();
    render(<TripCrossSellRow onReviewTrips={onReviewTrips} testID="row" />);
    await waitFor(() => expect(screen.getByTestId('row')).toBeTruthy());

    fireEvent.press(screen.getByTestId('quiz-crosssell-review'));

    expect(onReviewTrips).toHaveBeenCalled();
  });

  it('says "1 trip", not "1 trips"', async () => {
    mockCountSegments.mockResolvedValue(1);

    render(<TripCrossSellRow onReviewTrips={jest.fn()} testID="row" />);

    await waitFor(() => expect(screen.getByText(SCAN_COPY.quiz.crossSell(1))).toBeTruthy());
    expect(SCAN_COPY.quiz.crossSell(1)).toMatch(/1 trip you/);
  });
});
