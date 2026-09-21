import React from 'react';
import { Dimensions, StyleSheet, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import StageCard from '@components/photos/StageCard';
import { colors, withAlpha } from '@constants/colors';

describe('StageCard', () => {
  it('keeps a fixed 4:5 frame inset from the screen edges', () => {
    render(
      <StageCard testID="stage-card">
        <Text>shelf</Text>
      </StageCard>
    );

    const frame = StyleSheet.flatten(screen.getByTestId('stage-card').props.style);
    const width = Dimensions.get('window').width - 48;

    expect(frame).toEqual(
      expect.objectContaining({
        width,
        aspectRatio: 4 / 5,
        borderRadius: 24,
        backgroundColor: colors.warmCream,
        borderWidth: 1,
        borderColor: withAlpha(colors.midnightNavy, 0.06),
        overflow: 'hidden',
        shadowOpacity: 0.18,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 12 },
      })
    );
    expect(screen.getByText('shelf')).toBeTruthy();
  });
});
