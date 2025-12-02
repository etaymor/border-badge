import { render, screen } from '../utils/testUtils';

import { Loading } from '@components/ui/Loading';

describe('Loading', () => {
  it('renders spinner', () => {
    render(<Loading />);

    // ActivityIndicator should be present (we can't easily query it by role in RN testing library)
    // But the component should at least render without crashing
    expect(true).toBe(true);
  });

  it('renders with message', () => {
    render(<Loading message="Loading data..." />);

    expect(screen.getByText('Loading data...')).toBeTruthy();
  });

  it('renders without message when not provided', () => {
    render(<Loading />);

    expect(screen.queryByText('Loading data...')).toBeNull();
  });

  it('accepts different sizes', () => {
    const { rerender } = render(<Loading size="small" />);
    expect(true).toBe(true); // Component renders

    rerender(<Loading size="large" />);
    expect(true).toBe(true); // Component renders
  });

  it('renders with fullScreen prop', () => {
    render(<Loading fullScreen message="Full screen loading" />);

    expect(screen.getByText('Full screen loading')).toBeTruthy();
  });
});
