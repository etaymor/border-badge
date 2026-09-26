import { StyleSheet, Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { StageHero, STAGE_SHEET_OVERLAP, useStageInsets } from '@components/photos/StageHero';
import { colors } from '@constants/colors';

function InsetsProbe() {
  const insets = useStageInsets();
  return <Text testID="insets">{`${insets.top},${insets.bottom}`}</Text>;
}

describe('StageHero', () => {
  it('fills the navy hero edge to edge with the visual, header on top', () => {
    render(
      <StageHero testID="hero" header={<Text>Header</Text>}>
        <InsetsProbe />
      </StageHero>
    );

    expect(StyleSheet.flatten(screen.getByTestId('hero').props.style).backgroundColor).toBe(
      colors.midnightNavy
    );
    expect(StyleSheet.flatten(screen.getByTestId('stage-fill').props.style)).toMatchObject({
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    });
    expect(screen.getByText('Header')).toBeTruthy();
    expect(screen.getByTestId('stage-header-scrim')).toBeTruthy();
  });

  it('publishes the band the header and sheet leave visible', () => {
    render(
      <StageHero header={<Text testID="header">Header</Text>}>
        <InsetsProbe />
      </StageHero>
    );

    fireEvent(screen.getByTestId('header').parent!.parent!, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 402, height: 118 } },
    });

    expect(screen.getByTestId('insets').props.children).toBe(`118,${STAGE_SHEET_OVERLAP}`);
  });
});
