import { changedFields } from '../../src/auth/admin-audit-store';

/**
 * What an audit entry records.
 *
 * `changedFields` decides what an administrator reads six months later, so its
 * failure modes are both quiet and bad: report too much and the one real edit is
 * buried among fifteen untouched fields; report too little and a change is
 * invisible in the log that exists to show it.
 */
describe('changedFields', () => {
  it('returns nothing when nothing moved', () => {
    const rec = { displayName: 'Sam', email: 'a@b.co', role: 'player' };
    expect(changedFields(rec, { ...rec })).toEqual({ before: {}, after: {} });
  });

  it('reports only the field that changed', () => {
    const before = { displayName: 'Sam', email: 'a@b.co', role: 'player' };
    const after = { displayName: 'Samuel', email: 'a@b.co', role: 'player' };
    expect(changedFields(before, after)).toEqual({
      before: { displayName: 'Sam' },
      after: { displayName: 'Samuel' },
    });
  });

  it('keeps the previous value, not just the new one', () => {
    // The whole point of an audit entry is what it USED to be. An entry saying
    // only "role is now ops" cannot answer whether that was a change.
    const { before } = changedFields({ role: 'player' }, { role: 'ops' });
    expect(before).toEqual({ role: 'player' });
  });

  it('records a field being cleared', () => {
    // null and undefined are distinct outcomes and both are real: `$unset`
    // leaves the key absent, while the admin record renders it as null.
    const diff = changedFields({ phone: '+123' }, { phone: null });
    expect(diff).toEqual({ before: { phone: '+123' }, after: { phone: null } });
  });

  it('does not report a structurally identical object as changed', () => {
    // Compared by value, not reference. A reference check would mark every
    // nested field as changed on every write, and a log that always says
    // "everything changed" says nothing at all.
    const before = { meta: { a: 1, b: [1, 2] } };
    const after = { meta: { a: 1, b: [1, 2] } };
    expect(changedFields(before, after)).toEqual({ before: {}, after: {} });
  });

  it('notices a nested value that actually moved', () => {
    const diff = changedFields({ meta: { a: 1 } }, { meta: { a: 2 } });
    expect(diff.after).toEqual({ meta: { a: 2 } });
  });

  it('reports a key that only exists on one side', () => {
    // A field appearing for the first time — suspendedAt on a suspension — is a
    // change, even though `before` has no key for it to differ from.
    const diff = changedFields(
      {} as Record<string, unknown>,
      { suspendedAt: '2026-01-01T00:00:00.000Z' },
    );
    expect(diff.after).toEqual({ suspendedAt: '2026-01-01T00:00:00.000Z' });
    expect(diff.before).toEqual({ suspendedAt: undefined });
  });

  it('ignores updatedAt, which moves on every single write', () => {
    // Without this, every entry in the log carries a timestamp diff that is true
    // of every other entry too, and the one field that actually changed is read
    // alongside noise. The entry's own createdAt already says when.
    const diff = changedFields(
      { displayName: 'Sam', updatedAt: '2026-01-01T00:00:00.000Z' },
      { displayName: 'Samuel', updatedAt: '2026-01-02T00:00:00.000Z' },
    );
    expect(diff.after).toEqual({ displayName: 'Samuel' });
    expect(diff.before).toEqual({ displayName: 'Sam' });
  });

  it('records nothing at all when only bookkeeping moved', () => {
    // Which is what makes the route's "did anything change?" check correct: a
    // save that touched no real field must not write an audit entry.
    const diff = changedFields(
      { displayName: 'Sam', updatedAt: '2026-01-01T00:00:00.000Z' },
      { displayName: 'Sam', updatedAt: '2026-01-02T00:00:00.000Z' },
    );
    expect(diff.after).toEqual({});
  });

  it('treats false and null as different from absent', () => {
    // `emailVerified` is a three-state field: true, false, and never-asked. A
    // truthiness comparison would collapse two of those and lose the edit.
    expect(changedFields({ emailVerified: null }, { emailVerified: false }).after).toEqual({
      emailVerified: false,
    });
  });
});
