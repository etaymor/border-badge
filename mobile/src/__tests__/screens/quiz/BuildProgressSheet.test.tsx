import mockReact from 'react';
import { Text as MockText } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { BuildProgressSheet } from '@screens/quiz/creation/BuildProgressSheet';
import type { BuildView } from '@screens/quiz/creation/useQuizCreationFlow';

const mockRowsRender = jest.fn();

jest.mock('@components/photos/CountryDiscoveryRows', () => ({
  CountryDiscoveryRows: mockReact.memo((props: { isComplete: boolean; isPaused: boolean }) => {
    mockRowsRender(props);
    return <MockText testID="mock-country-rows">Country rows</MockText>;
  }),
}));

jest.mock('@hooks/useContinuationLeaseState', () => ({
  useLeaseKeepsRunning: () => false,
}));

const build = (step: BuildView['step']): BuildView => ({
  step,
  pickUris: [],
  countryPreviews: [{ code: 'PT', name: 'Portugal', previews: [] }],
  lastPickUri: null,
  uploading: step === 'building',
  uploadedCount: 0,
  barFraction: 0,
  foundCount: 0,
  foundTotal: 10,
  showCounter: true,
  slotTotal: 10,
  examined: 0,
});

describe('BuildProgressSheet country arrival handover', () => {
  beforeEach(() => {
    mockRowsRender.mockClear();
  });

  it('flushes discovery completion before handing the fixed layer to the slot grid', () => {
    const { rerender } = render(
      <BuildProgressSheet
        build={build('scanning')}
        isFirstScan
        durationLine=""
        reduceMotion
        isPaused={false}
        onLeave={jest.fn()}
        onStop={jest.fn()}
      />
    );

    rerender(
      <BuildProgressSheet
        build={build('checking')}
        isFirstScan
        durationLine=""
        reduceMotion
        isPaused={false}
        onLeave={jest.fn()}
        onStop={jest.fn()}
      />
    );

    expect(mockRowsRender).toHaveBeenCalledWith(
      expect.objectContaining({ isComplete: true, isPaused: false })
    );
    expect(screen.getByTestId('quiz-slot-empty-0')).toBeTruthy();
  });
});
