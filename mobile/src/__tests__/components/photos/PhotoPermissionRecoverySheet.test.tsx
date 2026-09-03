import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { PhotoPermissionRecoverySheet } from '@components/photos/PhotoPermissionRecoverySheet';
import { SCAN_COPY } from '@constants/scanCopy';

describe('PhotoPermissionRecoverySheet', () => {
  it('renders denied copy and settings CTA', () => {
    const onOpenSettings = jest.fn();
    render(<PhotoPermissionRecoverySheet variant="denied" onOpenSettings={onOpenSettings} />);

    expect(screen.getByText(SCAN_COPY.permission.recoveryTitleDenied)).toBeTruthy();
    expect(screen.getByText(SCAN_COPY.permission.recoveryPrivacyReportTip)).toBeTruthy();
    fireEvent.press(screen.getByText(SCAN_COPY.permission.recoveryOpenSettingsCta));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(SCAN_COPY.permission.recoveryAllowMorePhotosCta)).toBeNull();
  });

  it('renders limited continue when provided', () => {
    const onContinueLimited = jest.fn();
    render(
      <PhotoPermissionRecoverySheet
        variant="limited"
        onOpenSettings={jest.fn()}
        onContinueLimited={onContinueLimited}
      />
    );

    expect(screen.getByText(SCAN_COPY.permission.recoveryTitleLimited)).toBeTruthy();
    fireEvent.press(screen.getByText(SCAN_COPY.permission.recoveryContinueLimitedCta));
    expect(onContinueLimited).toHaveBeenCalledTimes(1);
  });

  it('prefers Allow More Photos as the limited upgrade CTA', () => {
    const onAllowMorePhotos = jest.fn();
    render(
      <PhotoPermissionRecoverySheet
        variant="limited"
        onOpenSettings={jest.fn()}
        onAllowMorePhotos={onAllowMorePhotos}
        onContinueLimited={jest.fn()}
      />
    );

    fireEvent.press(screen.getByText(SCAN_COPY.permission.recoveryAllowMorePhotosCta));
    expect(onAllowMorePhotos).toHaveBeenCalledTimes(1);
  });
});
