import { describe, expect, it } from 'vitest';
import { selectStoredAccount } from '../src/lib/stored-account';

const first = { id: 'one', username: 'yourhandle', access_token_enc: 'encrypted-one' };
const second = { id: 'two', username: 'another', access_token_enc: 'encrypted-two' };

describe('stored account selection', () => {
  it('uses the only account without an environment ID', () => {
    expect(selectStoredAccount([first])).toBe(first);
  });
  it('selects by username when more than one account exists', () => {
    expect(selectStoredAccount([first, second], 'another')).toBe(second);
  });
  it('directs operators to exchange the token when no account exists', () => {
    expect(() => selectStoredAccount([])).toThrow(/run exchange-token first/i);
  });
  it('requires a username when more than one account exists', () => {
    expect(() => selectStoredAccount([first, second])).toThrow(/IG_USERNAME/);
  });
});
