import { withNativeTimeout } from '../../utils/withNativeTimeout';

const never = () => new Promise<never>(() => {});

describe('withNativeTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('passes a settled result through', async () => {
    await expect(withNativeTimeout(Promise.resolve('ok'), 'work', 1000)).resolves.toBe('ok');
  });

  it('rejects when the work never settles within the bound', async () => {
    const pending = withNativeTimeout(never(), 'Image.getSize', 1000);
    jest.advanceTimersByTime(1000);
    await expect(pending).rejects.toThrow('Image.getSize timed out after 1000ms');
  });

  it('rejects as soon as the signal aborts, without waiting out the bound', async () => {
    const controller = new AbortController();
    const pending = withNativeTimeout(never(), 'copyAsync', 60_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('copyAsync aborted');
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(withNativeTimeout(never(), 'upload', null, controller.signal)).rejects.toThrow(
      'upload aborted'
    );
  });
});
