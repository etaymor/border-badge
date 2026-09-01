import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { PhotoPermissionPreheat } from '@components/photos/PhotoPermissionPreheat';
import { SCAN_COPY } from '@constants/scanCopy';

describe('PhotoPermissionPreheat', () => {
  it('renders OS-shaped Full Access as the primary CTA', () => {
    render(<PhotoPermissionPreheat onChoose={jest.fn()} />);

    expect(screen.getByText(SCAN_COPY.permission.preheatTitle)).toBeTruthy();
    expect(screen.getByText(SCAN_COPY.permission.preheatAllowFullAccess)).toBeTruthy();
    expect(screen.getByText(SCAN_COPY.permission.preheatSelectPhotos)).toBeTruthy();
    expect(screen.getByText(SCAN_COPY.permission.preheatDontAllow)).toBeTruthy();
  });

  it('reports full-access when Allow Full Access is pressed', () => {
    const onChoose = jest.fn();
    render(<PhotoPermissionPreheat onChoose={onChoose} />);

    fireEvent.press(screen.getByTestId('photo-permission-preheat-full-access'));
    expect(onChoose).toHaveBeenCalledWith('full-access');
  });

  it('reports select-photos without implying an OS call from the component', () => {
    const onChoose = jest.fn();
    render(<PhotoPermissionPreheat onChoose={onChoose} />);

    fireEvent.press(screen.getByTestId('photo-permission-preheat-select'));
    expect(onChoose).toHaveBeenCalledWith('select-photos');
  });

  it('reports dont-allow for the recovery branch', () => {
    const onChoose = jest.fn();
    render(<PhotoPermissionPreheat onChoose={onChoose} />);

    fireEvent.press(screen.getByTestId('photo-permission-preheat-dont-allow'));
    expect(onChoose).toHaveBeenCalledWith('dont-allow');
  });
});
