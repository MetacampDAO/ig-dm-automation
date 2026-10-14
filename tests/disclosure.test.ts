import { beforeEach, describe, expect, it } from 'vitest';
import { campaignCopyIssues, disclosureIssue } from '../src/lib/copy';
import { env, resetEnvForTests } from '../src/lib/env';
import { exampleCampaignSeed } from '../src/lib/seed-data';
import type { Campaign } from '../src/lib/repository';
import { DISCLOSURE, DISCLOSURE_URL, clearDisclosureEnv, setDisclosureEnv } from './disclosure-fixture';

beforeEach(() => {
  process.env.META_APP_ID = 'mock'; process.env.META_APP_SECRET = 'secret'; process.env.WEBHOOK_VERIFY_TOKEN = 'verify'; process.env.SUPABASE_URL = 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder'; process.env.SUPABASE_ANON_KEY = 'placeholder'; process.env.ADMIN_EMAILS = 'admin@example.com'; process.env.META_MOCK = '1';
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64'); process.env.OPTOUT_HASH_KEY = Buffer.alloc(32, 2).toString('base64'); process.env.JOB_SECRET = 'test-job-secret-long-enough-123456'; process.env.APP_URL = 'https://app.example.com';
  process.env.IG_USERNAME = 'yourhandle'; delete process.env.BRAND_NAME; delete process.env.JOB_NAME; clearDisclosureEnv(); resetEnvForTests();
});

const direct = (text: string): Campaign => ({ ...exampleCampaignSeed('account', 'media', null), id: 'id', delivery_style: 'direct' as const, direct_text: text });

describe('required disclosure rule', () => {
  it('fires when REQUIRED_DISCLOSURE_URL and TEXT are set and the copy links to that URL', () => {
    setDisclosureEnv(); resetEnvForTests();
    expect(campaignCopyIssues(direct(`See ${DISCLOSURE_URL}`))).toContain(disclosureIssue(DISCLOSURE));
    expect(campaignCopyIssues(direct(`See ${DISCLOSURE_URL} ${DISCLOSURE}`))).not.toContain(disclosureIssue(DISCLOSURE));
    expect(campaignCopyIssues(direct('See https://example.com/other'))).not.toContain(disclosureIssue(DISCLOSURE));
  });
  it('is silent when the pair is unset', () => {
    expect(campaignCopyIssues(direct(`See ${DISCLOSURE_URL}`))).not.toContain(disclosureIssue(DISCLOSURE));
    process.env.REQUIRED_DISCLOSURE_URL = ''; process.env.REQUIRED_DISCLOSURE_TEXT = ''; resetEnvForTests();
    expect(campaignCopyIssues(direct(`See ${DISCLOSURE_URL}`)).filter((issue) => /required disclosure/i.test(issue))).toEqual([]);
  });
  it('rejects a half-set pair instead of silently turning the rule off', () => {
    process.env.REQUIRED_DISCLOSURE_URL = DISCLOSURE_URL; resetEnvForTests();
    expect(() => env()).toThrow(/REQUIRED_DISCLOSURE/);
    clearDisclosureEnv(); process.env.REQUIRED_DISCLOSURE_TEXT = DISCLOSURE; resetEnvForTests();
    expect(() => env()).toThrow(/REQUIRED_DISCLOSURE/);
  });
});

describe('brand environment', () => {
  it('defaults BRAND_NAME and JOB_NAME and requires IG_USERNAME', () => {
    expect(env().BRAND_NAME).toBe('IG DM Automation'); expect(env().JOB_NAME).toBe('ig-dm-jobs');
    delete process.env.IG_USERNAME; resetEnvForTests(); expect(() => env()).toThrow(/IG_USERNAME/);
  });
  it('reads overrides', () => {
    process.env.BRAND_NAME = 'Example Co'; process.env.JOB_NAME = 'custom-jobs'; resetEnvForTests();
    expect(env().BRAND_NAME).toBe('Example Co'); expect(env().JOB_NAME).toBe('custom-jobs');
  });
});
