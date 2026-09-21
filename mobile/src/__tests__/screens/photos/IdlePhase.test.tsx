/**
 * IdlePhase on the shared stage.
 *
 * A first run holds the passport beat and offers one magnitude line. A return
 * visit holds the reading grid and names the last scan. The privacy block is
 * gone: the carousel already made that case.
 */

import { render, screen } from '../../utils/testUtils';
import { IdlePhase } from '@screens/photos/components/IdlePhase';
import { SCAN_COPY } from '@constants/scanCopy';

function renderIdle(lastImportTime: number | null, cachedPhotoCount?: number) {
  return render(
    <IdlePhase
      autoStart={undefined}
      lastImportTime={lastImportTime}
      homeCountry="US"
      onStartScan={jest.fn()}
      onLeave={jest.fn()}
      cachedPhotoCount={cachedPhotoCount}
    />
  );
}

describe('IdlePhase', () => {
  it('holds the passport beat and omits the privacy notice on a first run', () => {
    renderIdle(null, 53_000);

    expect(screen.getByTestId('permission-beat-3')).toBeTruthy();
    expect(screen.getByText(SCAN_COPY.trips.idleTitleFirst)).toBeTruthy();
    expect(screen.getByText('About 53,000 photos · several minutes')).toBeTruthy();
    expect(screen.getByText(SCAN_COPY.trips.idleCtaFirst)).toBeTruthy();
    expect(screen.getByTestId('photo-import-lock-footer')).toBeTruthy();
    expect(screen.queryByTestId('photo-import-privacy')).toBeNull();
    expect(screen.queryByText(SCAN_COPY.trips.idleBodyFirst)).toBeNull();
  });

  it('holds the reading grid and names the last scan on a return visit', () => {
    renderIdle(Date.now() - (3 * 24 + 1) * 60 * 60 * 1000);

    expect(screen.getByTestId('scan-stage-reading-grid')).toBeTruthy();
    expect(screen.queryByTestId('permission-beat-3')).toBeNull();
    expect(screen.getAllByText(SCAN_COPY.trips.idleTitleReturning)).toHaveLength(2);
    expect(screen.getByText('Last scanned 3 days ago')).toBeTruthy();
    expect(screen.getByTestId('photo-import-refresh')).toBeTruthy();
    expect(screen.queryByTestId('photo-import-privacy')).toBeNull();
    expect(screen.queryByTestId('photo-import-lock-footer')).toBeNull();
    expect(screen.queryByText(SCAN_COPY.trips.idleBodyReturning)).toBeNull();
  });
});
