import { createHash } from 'node:crypto';
import { buildTimeStampReq, Rfc3161Notary } from '../../src/fairness/rfc3161-notary';

describe('RFC 3161 notary', () => {
  const data = 'merkle-root-abc123';

  it('builds a well-formed TimeStampReq carrying SHA-256(data)', () => {
    const req = buildTimeStampReq(data);
    const hex = Buffer.from(req).toString('hex');

    expect(req[0]).toBe(0x30); // outer SEQUENCE
    // version INTEGER 1, and certReq BOOLEAN TRUE, are present.
    expect(hex).toContain('020101');
    expect(hex).toContain('0101ff');
    // SHA-256 AlgorithmIdentifier OID.
    expect(hex).toContain('06096086480165030402010500');
    // The imprint is the real digest, inside an OCTET STRING (04 20 ‖ 32 bytes).
    const digest = createHash('sha256').update(data).digest('hex');
    expect(hex).toContain(`0420${digest}`);
    // DER outer length matches the body.
    expect(req.length).toBe(2 + req[1]!);
  });

  it('is deterministic', () => {
    expect(Buffer.from(buildTimeStampReq(data)).equals(Buffer.from(buildTimeStampReq(data)))).toBe(true);
    expect(Buffer.from(buildTimeStampReq('other')).equals(Buffer.from(buildTimeStampReq(data)))).toBe(false);
  });

  it('POSTs the request and derives a stable token id from the TSA response', async () => {
    let sentUrl = '';
    let sentReq: Uint8Array | null = null;
    const fakeToken = Uint8Array.from([1, 2, 3, 4, 5]);
    const notary = new Rfc3161Notary('http://tsa.example', async (url, req) => {
      sentUrl = url;
      sentReq = req;
      return fakeToken;
    });

    const id = await notary.timestamp(data);
    expect(sentUrl).toBe('http://tsa.example');
    expect(Buffer.from(sentReq!).equals(Buffer.from(buildTimeStampReq(data)))).toBe(true);
    // Id is a stable digest of the response token.
    const expected = `rfc3161-${createHash('sha256').update(fakeToken).digest('hex').slice(0, 32)}`;
    expect(id).toBe(expected);
  });
});
