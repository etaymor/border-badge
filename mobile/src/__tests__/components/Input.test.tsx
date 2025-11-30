import { fireEvent, render, screen } from '../utils/testUtils';

import { Input } from '@components/ui/Input';

describe('Input', () => {
  it('renders with label', () => {
    render(<Input label="Email" placeholder="Enter email" />);

    expect(screen.getByText('Email')).toBeTruthy();
  });

  it('shows error message when provided', () => {
    render(<Input label="Email" error="Email is required" />);

    expect(screen.getByText('Email is required')).toBeTruthy();
  });

  it('handles text input', () => {
    const onChangeText = jest.fn();
    render(<Input label="Email" placeholder="Enter email" onChangeText={onChangeText} />);

    const input = screen.getByPlaceholderText('Enter email');
    fireEvent.changeText(input, 'test@example.com');

    expect(onChangeText).toHaveBeenCalledWith('test@example.com');
  });

  it('renders without label', () => {
    render(<Input placeholder="Enter text" />);

    expect(screen.getByPlaceholderText('Enter text')).toBeTruthy();
  });
});
