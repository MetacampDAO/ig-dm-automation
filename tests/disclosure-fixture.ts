export const DISCLOSURE_URL = 'https://example.com/disclosed/';
export const DISCLOSURE = 'This guide is for information only.';
export const OTHER_URL = 'https://example.com/more';
export function setDisclosureEnv(): void { process.env.REQUIRED_DISCLOSURE_URL = DISCLOSURE_URL; process.env.REQUIRED_DISCLOSURE_TEXT = DISCLOSURE; }
export function clearDisclosureEnv(): void { delete process.env.REQUIRED_DISCLOSURE_URL; delete process.env.REQUIRED_DISCLOSURE_TEXT; }
