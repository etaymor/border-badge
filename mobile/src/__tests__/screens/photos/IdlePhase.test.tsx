/**
 * IdlePhase first-run copy.
 *
 * One scan feeds two features, and entry points promise both (PhotoSyncCard
 * on the passport home says "Unlock trips and Guess Where"). These assertions
 * exist so the shared explanation cannot drift back to a trips-only story, and
 * so the privacy bullet keeps naming both upload triggers.
 */

import { render, screen } from '../../utils/testUtils';
import { IdlePhase } from '@screens/photos/components/IdlePhase';

function renderIdle(lastImportTime: number | null) {
  return render(
    <IdlePhase
      autoStart={undefined}
      lastImportTime={lastImportTime}
      homeCountryName="United States"
      onStartScan={jest.fn()}
    />
  );
}

describe('IdlePhase first-run copy', () => {
  it('names both payoffs of the one scan', () => {
    renderIdle(null);

    expect(screen.getByText(/builds trips/i)).toBeTruthy();
    expect(screen.getByText(/Guess Where/i)).toBeTruthy();
  });

  it('names both upload triggers in the privacy notice', () => {
    renderIdle(null);

    expect(screen.getByText('Your photos stay private')).toBeTruthy();
    expect(screen.getByText(/save a place or share a challenge/i)).toBeTruthy();
    expect(screen.getByText(/entirely on your device/i)).toBeTruthy();
  });

  it('drops the privacy notice once the library has been scanned', () => {
    renderIdle(1_700_000_000_000);

    expect(screen.queryByText('Your photos stay private')).toBeNull();
  });
});
