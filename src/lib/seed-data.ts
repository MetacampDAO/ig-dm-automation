import { profileUrl } from './campaign-fields';
import { env } from './env';

export const EXAMPLE_LINK_URL = 'https://example.com/guide';
export const EXAMPLE_SECOND_LINK_URL = 'https://example.com/more';

export function exampleCampaignSeed(accountId: string, mediaId: string | null, mediaPermalink: string | null, username: string = env().IG_USERNAME) {
  const comparison = `Here's a quick comparison of the two options:\n\n• Option A: the simple route, best for getting started.\n• Option B: the fuller route, best when you want more detail.\n\nBoth are covered in the guide.`;
  const links = `The guide and the extra resources are below.\n\nThis is an example message: replace it with your own copy before activating.`;
  const direct = `Guide: ${EXAMPLE_LINK_URL}\n\nMore resources: ${EXAMPLE_SECOND_LINK_URL}\n\nThis is an example message: replace it with your own copy before activating.`;
  if (links.length > 640 || direct.length > 640) throw new Error('Seed copy exceeds 640 characters');
  return {
    account_id: accountId, name: 'Example: comment GUIDE', media_id: mediaId, media_permalink: mediaPermalink, media_caption_line: null,
    keywords: ['GUIDE'], fuzzy: false, require_follow: false, delivery_style: 'opening' as const, opening_button_experiment: false, comment_reply_text: null,
    opening_text: 'Hey! Reply SEND and we\'ll send the guide and links.',
    opening_button_text: 'Hey! Here\'s our automated reply to your comment. Tap below for the guide and links.',
    follow_opening_text: `Hey! Follow @${username}, then reply SEND and we'll send the guide and links.`,
    follow_opening_button_text: `Hey! Follow @${username} to receive the guide and links. Tap below to continue.`,
    opening_button_title: 'Send guide', follow_opening_button_title: 'Continue', direct_text: direct, comparison_text: comparison,
    comparison_sources: [EXAMPLE_LINK_URL, EXAMPLE_SECOND_LINK_URL], comparison_checked_at: null, delivery_text: links,
    delivery_buttons: [{ type: 'web_url' as const, title: 'Guide', url: EXAMPLE_LINK_URL }, { type: 'web_url' as const, title: 'More resources', url: EXAMPLE_SECOND_LINK_URL }],
    follow_prompt_text: `Please follow @${username}, then come back and tap “I've followed” so we can send the guide.`,
    follow_retry_text: "We can't see the follow yet. If you've just followed, give it a moment and tap “Check again”.",
    follow_unknown_text: "We couldn't check your follow status just now. Tap to try again, or reply HELP and our team can assist.",
    follow_profile_url: profileUrl(username),
    status: 'draft' as const, copy_approved: false, links_verified: false, revision: 1, approved_revision: null,
  };
}
