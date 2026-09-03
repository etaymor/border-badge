import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { PhotoLibraryInfoModal } from '@screens/profile/components/PhotoLibraryInfoModal';
import { SCAN_COPY } from '@constants/scanCopy';
import { presentLimitedPhotoPickerOrOpenSettings } from '@services/photoImport/photoImportService';

jest.mock('@services/photoImport/photoImportService', () => ({
  presentLimitedPhotoPickerOrOpenSettings: jest.fn(async () => 'picker'),
}));

const mockedPresent = presentLimitedPhotoPickerOrOpenSettings as jest.MockedFunction<
  typeof presentLimitedPhotoPickerOrOpenSettings
>;

describe('PhotoLibraryInfoModal limited manage', () => {
  beforeEach(() => {
    mockedPresent.mockClear();
    mockedPresent.mockResolvedValue('picker');
  });

  it('prefers the limited picker from Allow More Photos', async () => {
    render(<PhotoLibraryInfoModal visible isLimitedAccess onClose={jest.fn()} />);

    fireEvent.press(screen.getByTestId('photo-library-allow-more'));
    await waitFor(() => expect(mockedPresent).toHaveBeenCalledTimes(1));
    expect(screen.getByText(SCAN_COPY.permission.recoveryAllowMorePhotosCta)).toBeTruthy();
  });

  it('does not show Allow More Photos for full access', () => {
    render(<PhotoLibraryInfoModal visible isLimitedAccess={false} onClose={jest.fn()} />);

    expect(screen.queryByTestId('photo-library-allow-more')).toBeNull();
  });
});
