# Meta API notes

Facts checked against Meta's official documentation on 2026-09-24. Re-check the docs before relying on them; Meta changes limits and fields. Anything marked UNVERIFIED is tracked in [UNVERIFIED.md](UNVERIFIED.md).

Sources (all under https://developers.facebook.com/documentation/instagram-platform/):
- private-replies · webhooks · overview · instagram-api-with-instagram-login/messaging-api · instagram-api-with-instagram-login/business-login

## Private reply to a comment (Instagram Login)
POST https://graph.instagram.com/{VERSION}/{IG_ID}/messages
Body: {"recipient":{"comment_id":"<COMMENT_ID>"},"message":{"text":"<TEXT>"}}
Docs show TEXT ONLY for private replies. Button/template in the initial private reply is UNDOCUMENTED -> implemented as an experiment flag (try the template; on 4xx fall back to text asking to reply SEND).
Limits: within 7 days of the comment; one private reply per comment; 750 private replies/hour/account. Follow-ups only within 24h after the user responds.
Permissions: instagram_business_basic, instagram_business_manage_comments (+ instagram_business_manage_messages for ordinary messages).
Response: {"recipient_id":"...","message_id":"..."}

## Reply to a comment (Instagram Login)
POST https://graph.instagram.com/{VERSION}/{IG_COMMENT_ID}/replies
Body: {"message":"<TEXT>"}
Response: {"id":"<REPLY_ID>"}
Permission: instagram_business_manage_comments.
The public reply is queued only after Meta accepts the comment-keyed private reply. Confirm the request form, response shape, rate limits, and mobile threading on a live account; see UNVERIFIED.md.

## Ordinary message + button template
POST https://graph.instagram.com/{VERSION}/{IG_ID}/messages
{"recipient":{"id":"<IGSID>"},"message":{"text":"..."}}
Button template: {"recipient":{"id":"<IGSID>"},"message":{"attachment":{"type":"template","payload":{"template_type":"button","text":"<TEXT>","buttons":[{"type":"web_url","title":"<TITLE>","url":"<URL>"},{"type":"postback","title":"<TITLE>","payload":"<PAYLOAD>"}]}}}}
Max 3 buttons; text <= 1000 bytes (this app enforces the stricter 640 characters for safety).
Rate: 100 sends/sec/account.

## Webhooks
Subscribe: POST https://graph.instagram.com/{VERSION}/me/subscribed_apps?subscribed_fields=comments,messages,messaging_postbacks[,message_echoes]&access_token=...
Fields available: comments, live_comments, messages, message_reactions, message_echoes, messaging_handover, messaging_optins, messaging_postbacks, messaging_referral, messaging_seen, standby.
Verification: GET with hub.mode=subscribe, hub.challenge, hub.verify_token -> respond with hub.challenge if token matches.
Signature: header X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(raw body, APP_SECRET).
Inbound message payload (inside entry[].messaging[]): {"sender":{"id":"<IGSID>"},"recipient":{"id":"<IG_ID>"},"timestamp":1000000000000,"message":{"mid":"...","text":"..."}}  (echoes carry "message":{"is_echo":true,...} - ignore them)
Postback payload: {"sender":{"id":"<IGSID>"},"recipient":{"id":"<IG_ID>"},"timestamp":...,"postback":{"payload":"...","title":"..."}}
Comments payload (entry[].changes[] with field "comments"): value includes the app user's IG account ID, commenter id + username ("from"), comment id ("id"), media id ("media":{"id"}), and "text". Exact shape: verify against a real event; the parser is tolerant and `DEBUG_RAW_EVENTS=1` can log the raw payload temporarily.
ACCESS WARNING: webhooks doc says "Advanced Access is required to receive comments and live_comments webhook notifications" and "Your app must be set to Live"; the overview says Standard Access suffices for accounts you own. Contradiction -> treat as UNVERIFIED; a live test with a non-tester account decides (see UNVERIFIED.md).

## User profile / follow check
GET https://graph.instagram.com/{VERSION}/{IGSID}?fields=is_user_follow_business (also name, username, profile_pic, is_verified_user, follower_count). Requires user consent = the user must have messaged the account (postback/text) first. Absent field or error => UNKNOWN, never false.

## Tokens (Business Login for Instagram)
Authorize: https://www.instagram.com/oauth/authorize?client_id=&redirect_uri=&response_type=code&scope=instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments
Short-lived: POST https://api.instagram.com/oauth/access_token (client_id, client_secret, grant_type=authorization_code, redirect_uri, code) -> {access_token,user_id,permissions}
Long-lived (60d): GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=...&access_token=<short>
Refresh (token >=24h old, <60d): GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=<long> -> {access_token,token_type,expires_in}
Note: the App Dashboard "Generate token" button yields a long-lived token directly for app-role accounts; scripts must accept a pasted token too.

## API version
Docs currently show v25.0 in examples. Pin via env META_API_VERSION, default "v25.0".

## Owned media lookup for the post-link editor — UNVERIFIED
GET `https://graph.instagram.com/{VERSION}/me/media?fields=id,permalink,caption,timestamp&limit=50` with the Instagram user Bearer token. The editor follows cursor pages, inspecting at most 200 owned feed posts/Reels. It parses each returned `permalink` as an Instagram `/p/<shortcode>/` or `/reel/<shortcode>/` URL and matches the exact shortcode from the submitted link. It stores only the server-returned media ID, permalink and first caption line (80 characters). It never accepts a browser-supplied media ID. Confirm endpoint fields, cursor paging and Reel visibility with a live token before team use. See `UNVERIFIED.md`.
