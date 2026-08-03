import { Session } from '../../src/transport/session';
import { signMessage } from '../../src/transport/crypto';

const KEY = Buffer.alloc(32, 9);
const macFor = (seq: number, payload: string): string => signMessage(KEY, seq, payload);

describe('Session (anti-replay + HMAC + strikes)', () => {
  it('accepts strictly-increasing sequence numbers with valid HMAC', () => {
    const s = new Session('p1', KEY);
    expect(s.verifyInbound(1, '{"a":1}', macFor(1, '{"a":1}')).ok).toBe(true);
    expect(s.verifyInbound(2, '{"a":2}', macFor(2, '{"a":2}')).ok).toBe(true);
  });

  it('rejects replays / out-of-order sequence numbers', () => {
    const s = new Session('p1', KEY);
    s.verifyInbound(5, 'x', macFor(5, 'x'));
    const replay = s.verifyInbound(5, 'x', macFor(5, 'x'));
    expect(replay.ok).toBe(false);
    expect(replay.reason).toBe('bad_sequence');
    expect(s.verifyInbound(4, 'x', macFor(4, 'x')).ok).toBe(false); // older
  });

  it('rejects a bad HMAC', () => {
    const s = new Session('p1', KEY);
    const r = s.verifyInbound(1, '{"a":1}', 'deadbeef');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad_hmac');
  });

  it('disconnects after 3 strikes', () => {
    const s = new Session('p1', KEY, 3);
    expect(s.verifyInbound(1, 'x', 'bad').disconnect).toBe(false); // strike 1
    expect(s.verifyInbound(1, 'x', 'bad').disconnect).toBe(false); // strike 2
    const third = s.verifyInbound(1, 'x', 'bad'); // strike 3
    expect(third.disconnect).toBe(true);
    expect(s.strikeCount).toBe(3);
  });

  it('signs outbound messages with an incrementing sequence', () => {
    const s = new Session('p1', KEY);
    const a = s.signOutbound('{"type":"state"}');
    const b = s.signOutbound('{"type":"state"}');
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(a.mac).toBe(macFor(1, '{"type":"state"}'));
  });
});
