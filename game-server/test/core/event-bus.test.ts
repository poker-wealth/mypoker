import { EventBus } from '../../src/core/event-bus';

interface Events extends Record<string, unknown> {
  dealt: { cards: number };
  settled: { winner: string };
}

describe('EventBus', () => {
  it('delivers emitted payloads to subscribers', () => {
    const bus = new EventBus<Events>();
    const seen: number[] = [];
    bus.on('dealt', (p) => seen.push(p.cards));
    bus.emit('dealt', { cards: 2 });
    bus.emit('dealt', { cards: 5 });
    expect(seen).toEqual([2, 5]);
  });

  it('supports multiple subscribers and unsubscribe', () => {
    const bus = new EventBus<Events>();
    const a = jest.fn();
    const b = jest.fn();
    const offA = bus.on('settled', a);
    bus.on('settled', b);
    bus.emit('settled', { winner: 'p1' });
    offA();
    bus.emit('settled', { winner: 'p2' });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('once() fires a single time', () => {
    const bus = new EventBus<Events>();
    const fn = jest.fn();
    bus.once('dealt', fn);
    bus.emit('dealt', { cards: 1 });
    bus.emit('dealt', { cards: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs every handler even if one throws, then surfaces the error', () => {
    const bus = new EventBus<Events>();
    const good = jest.fn();
    bus.on('dealt', () => {
      throw new Error('boom');
    });
    bus.on('dealt', good);
    expect(() => bus.emit('dealt', { cards: 1 })).toThrow('boom');
    expect(good).toHaveBeenCalledTimes(1); // the good handler still ran
  });

  it('counts listeners and clears them', () => {
    const bus = new EventBus<Events>();
    bus.on('dealt', () => {});
    bus.on('dealt', () => {});
    expect(bus.listenerCount('dealt')).toBe(2);
    bus.removeAll();
    expect(bus.listenerCount('dealt')).toBe(0);
  });
});
