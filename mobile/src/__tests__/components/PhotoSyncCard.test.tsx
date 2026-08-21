/**
 * PhotoSyncCard - the passport home slot before any camera-roll scan.
 *
 * It stands in for GuessWhereCard, so the contract worth guarding is that it
 * names both unlocked features and leads somewhere on tap.
 */

import { fireEvent, render, screen } from '../utils/testUtils';
import { PhotoSyncCard } from '@components/passport';

describe('PhotoSyncCard', () => {
  it('names the action and what it unlocks', () => {
    render(<PhotoSyncCard onPress={jest.fn()} />);

    expect(screen.getByText('Sync Your Photos')).toBeTruthy();
    expect(screen.getByText('Unlock trips and Guess Where')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    render(<PhotoSyncCard onPress={onPress} />);

    fireEvent.press(screen.getByTestId('photo-sync-card'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
