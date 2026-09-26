import mockReact from 'react';
import { Text as MockText } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { SCAN_COPY } from '@constants/scanCopy';
import { BuildProgressSheet, QuizWorkingStage } from '@screens/quiz/creation/BuildProgressSheet';
import type { BuildView } from '@screens/quiz/creation/useQuizCreationFlow';

const mockRowsRender = jest.fn();

jest.mock('@components/photos/ScanStage', () => ({
  ScanStage: mockReact.memo((props: { isComplete: boolean; isPaused: boolean }) => {
    mockRowsRender(props);
    return <MockText testID="mock-scan-stage">Scan stage</MockText>;
  }),
}));

jest.mock('@hooks/useContinuationLeaseState', () => ({
  useLeaseKeepsRunning: () => false,
}));

const build = (step: BuildView['step']): BuildView => ({
  step,
  pickUris: [],
  countryPreviews: [{ code: 'PT', name: 'Portugal', previews: [] }],
  readingPreviews: [],
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

describe('QuizWorkingStage country arrival handover', () => {
  beforeEach(() => {
    mockRowsRender.mockClear();
  });

  it('flushes discovery completion before handing the card to the slot grid', () => {
    const { rerender } = render(
      <QuizWorkingStage build={build('scanning')} reduceMotion isPaused={false} />
    );

    rerender(<QuizWorkingStage build={build('checking')} reduceMotion isPaused={false} />);

    expect(mockRowsRender).toHaveBeenCalledWith(
      expect.objectContaining({ isComplete: true, isPaused: false })
    );
    expect(screen.getByTestId('quiz-slot-empty-0')).toBeTruthy();
    expect(screen.getByTestId('quiz-build-content-region')).toBeTruthy();
  });
});

describe('BuildProgressSheet', () => {
  it('rotates one status line and omits the privacy paragraphs', () => {
    render(
      <BuildProgressSheet
        build={build('checking')}
        isFirstScan
        reduceMotion
        onLeave={jest.fn()}
        onStop={jest.fn()}
      />
    );

    expect(screen.getByText(SCAN_COPY.quiz.workingTitle)).toBeTruthy();
    expect(screen.getByText(SCAN_COPY.shared.stageLines('quiz-build')[0])).toBeTruthy();
    expect(screen.getByTestId('quiz-leave-running')).toBeTruthy();
    expect(screen.getByTestId('quiz-cancel')).toBeTruthy();
    expect(screen.queryByTestId('quiz-privacy-line')).toBeNull();
    expect(screen.queryByTestId('quiz-trips-line')).toBeNull();
    expect(screen.queryByTestId('quiz-persistence-line')).toBeNull();
    expect(screen.queryByTestId('quiz-working-duration')).toBeNull();
  });
});
