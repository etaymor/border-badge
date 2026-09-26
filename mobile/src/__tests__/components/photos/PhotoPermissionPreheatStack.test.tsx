import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  PhotoPermissionPreheatStack,
  type PhotoPermissionPreheatChoice,
} from '@components/photos/PhotoPermissionPreheatStack';
import { SCAN_COPY } from '@constants/scanCopy';

describe('PhotoPermissionPreheatStack', () => {
  it('renders OS-shaped Full Access as the primary CTA', () => {
    render(<PhotoPermissionPreheatStack onChoose={jest.fn()} />);

    expect(screen.getByText(SCAN_COPY.permission.preheatAllowFullAccess)).toBeTruthy();
    expect(screen.getByText(SCAN_COPY.permission.preheatSelectPhotos)).toBeTruthy();
    expect(screen.getByText(SCAN_COPY.permission.preheatDontAllow)).toBeTruthy();
  });

  it.each<[string, PhotoPermissionPreheatChoice]>([
    ['photo-permission-preheat-full-access', 'full-access'],
    ['photo-permission-preheat-select', 'select-photos'],
    ['photo-permission-preheat-dont-allow', 'dont-allow'],
  ])('reports %s as %s', (testID, choice) => {
    const onChoose = jest.fn();
    render(<PhotoPermissionPreheatStack onChoose={onChoose} />);

    fireEvent.press(screen.getByTestId(testID));
    expect(onChoose).toHaveBeenCalledWith(choice);
  });
});
