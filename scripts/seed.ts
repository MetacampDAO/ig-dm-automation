import { seedCampaign } from '../src/lib/seed-campaign';

async function main(): Promise<void> {
  const result = await seedCampaign({ username: process.env.IG_USERNAME, mediaId: process.env.CAMPAIGN_MEDIA_ID, mediaPermalink: process.env.CAMPAIGN_MEDIA_PERMALINK });
  console.log(result.created ? 'Seeded the example campaign as an unapproved draft.' : 'The example campaign already exists; left unchanged.');
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
