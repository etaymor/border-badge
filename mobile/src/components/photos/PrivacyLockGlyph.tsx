import React from 'react';
import Svg, { Path } from 'react-native-svg';

import { colors } from '@constants/colors';

interface PrivacyLockGlyphProps {
  color?: string;
  size?: number;
  testID?: string;
}

export function PrivacyLockGlyph({
  color = colors.midnightNavy,
  size = 16,
  testID,
}: PrivacyLockGlyphProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      testID={testID}
      accessible={false}
      importantForAccessibility="no"
    >
      <Path
        d="M7 10V7a5 5 0 0 1 10 0v3M6 10h12a2 2 0 0 1 2 2v8H4v-8a2 2 0 0 1 2-2Z"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export default PrivacyLockGlyph;
