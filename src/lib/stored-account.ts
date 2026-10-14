export function selectStoredAccount<T extends { username: string }>(accounts: T[], username?: string): T {
  if (accounts.length === 0) throw new Error('No Instagram account stored; run exchange-token first');
  if (username) {
    const matches = accounts.filter((account) => account.username.toLowerCase() === username.toLowerCase());
    if (matches.length !== 1) throw new Error(`Expected one stored account for IG_USERNAME=${username}; run exchange-token first or check IG_USERNAME`);
    return matches[0];
  }
  if (accounts.length !== 1) throw new Error('Multiple Instagram accounts stored; set IG_USERNAME to choose one');
  return accounts[0];
}
