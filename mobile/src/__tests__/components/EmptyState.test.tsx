import { fireEvent, render, screen } from '../utils/testUtils';

import { EmptyState } from '@components/ui/EmptyState';

describe('EmptyState', () => {
  it('renders with title', () => {
    render(<EmptyState title="No items found" />);

    expect(screen.getByText('No items found')).toBeTruthy();
  });

  it('renders with title and description', () => {
    render(
      <EmptyState title="No items found" description="Try adding some items to get started." />
    );

    expect(screen.getByText('No items found')).toBeTruthy();
    expect(screen.getByText('Try adding some items to get started.')).toBeTruthy();
  });

  it('renders action button when actionLabel and onAction provided', () => {
    const onAction = jest.fn();
    render(<EmptyState title="No items" actionLabel="Add Item" onAction={onAction} />);

    // Primary variant button uppercases the label
    const button = screen.getByText('ADD ITEM');
    expect(button).toBeTruthy();
  });

  it('calls onAction when action button is pressed', () => {
    const onAction = jest.fn();
    render(<EmptyState title="No items" actionLabel="Add Item" onAction={onAction} />);

    // Primary variant button uppercases the label
    fireEvent.press(screen.getByText('ADD ITEM'));

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('does not render action button when actionLabel is missing', () => {
    const onAction = jest.fn();
    render(<EmptyState title="No items" onAction={onAction} />);

    expect(screen.queryByText('ADD ITEM')).toBeNull();
  });

  it('does not render action button when onAction is missing', () => {
    render(<EmptyState title="No items" actionLabel="Add Item" />);

    // Button should not be rendered when onAction is not provided
    expect(screen.queryByText('ADD ITEM')).toBeNull();
  });

  it('renders without description when not provided', () => {
    render(<EmptyState title="Empty" />);

    expect(screen.getByText('Empty')).toBeTruthy();
    expect(screen.queryByText('description')).toBeNull();
  });
});
