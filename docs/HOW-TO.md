# Operator guide

For the people who run campaigns from `/admin`, not for engineers. Setup is in the [README](../README.md).

## 1. What it does, in one flow

1. Someone comments a trigger word on a post you chose.
2. Within seconds they get the first private DM for that campaign: one complete message, a button to tap, or a request to reply `SEND`. If Instagram rejects a button, a text fallback asks them to reply `SEND`.
3. If the first DM asks for a tap or `SEND`, that response unlocks the links message, with up to three link buttons. An optional extra message can come first.
4. Optionally, a short public reply appears under their comment so other readers see the post is answered. It is off when the field is blank.
5. Nothing is sent to anyone who has not commented a trigger word. Nobody gets the same delivery twice. `STOP` in the DM stops all future automated messages to that person; `HELP` pauses them and flags the conversation for a human.

One **campaign** is one post, one set of trigger words and one set of messages. Only one campaign can be active per post.

Everything is managed at `<your app URL>/admin`.

## 2. Create and edit a campaign

Open `/admin`, choose **New campaign**, enter a unique **Name** and an **Instagram post or Reel link** from your own account, then choose **Create campaign**. The app creates the draft and resolves the link in one step. In the editor, confirm the resolved link and first caption line. If lookup fails the draft still exists: the error appears beside **Change post**, where you can fix the link and choose **Resolve**. The post must belong to the connected account and be among its last 200 posts.

The editor has six steps:

1. **Post:** check the resolved link and caption line. Use **Change post** and **Resolve** to replace it.
2. **Trigger:** enter the **Words that trigger the DM**, one word or phrase per line. Matching ignores case and punctuation. **Allow small typos** widens matching; check some sample comments before activating.
3. **First DM:** choose how the private reply works.
   - **Send everything in one DM** sends the full message immediately.
   - **Ask them to tap a button first** (the default) sends a message plus a button. If Instagram rejects the button, a text request to reply `SEND` is sent instead.
   - **Ask them to reply SEND** sends one message telling them to reply `SEND`.

   Only the fields for the chosen option appear.
4. **After they respond:** for the button and SEND modes, write the **Message with links** and add one to three **Link buttons**, each with a label of at most 20 characters and an HTTPS URL. Open **Optional extra message sent first** if a longer explanation should arrive before the links. You can list **Where you checked these facts** as optional HTTPS source links; these are never sent.
5. **Public reply under their comment:** leave blank for none, or write a short reply without links. It appears only after Instagram accepts the private DM.
6. **Require a follow first:** turn this on if the person must follow your account before getting the links. Fill in the first DM, the follow request, the early-tap reply, the "could not check" reply and the profile link. This works with the button and SEND modes.

Each message can have up to 640 characters and 1,000 UTF-8 bytes. Drafts can be incomplete; **Outstanding before activation** lists what is left. If the deployment sets a required disclosure, any message or button linking to the configured URL must include the disclosure text in the delivered message, and the editor says so. The preview approximates the layout; check the real result on a phone.

Use **Duplicate** to start a new draft from existing messages; its post and reviews are cleared. An approver can delete a draft only while it has no conversations. A paused campaign can be archived; **Show archived** reveals history, and archived campaigns cannot be reactivated.

## 3. Review, activate, pause

1. An approver opens the campaign and resolves every item under **Outstanding before activation**.
2. The approver reads every visible message and **Links to check**, and opens every destination on a phone.
3. The approver ticks **I've read every message** and **I've tapped every link on a phone**. The ticks apply to the current saved messages. **Activate** is available only when both boxes were ticked after the latest change and a post is resolved.
4. Watch the campaign **Activity** timeline. `sent` means Instagram accepted the request; it does not prove delivery or that the message was read. Review any `failed` or `uncertain` actions.
5. To change an active campaign, **Pause** it, edit, and save. Saving raises the revision and clears both review boxes, so an approver must review again. Pausing also blocks queued sends at dispatch time.

A saved edit affects sends that have not been queued yet. An action already queued keeps its message snapshot, and people midway through the flow can receive newly edited follow-ups after they reply. Pause and review first if that matters.

## 4. What the commenter sees

- A private DM from your account shortly after they comment. People who do not follow the account usually receive it in the **Requests** folder; that is Instagram behaviour.
- After they tap the button or reply `SEND`, the links message (and the optional extra message) arrives.
- With a follow requirement, they are asked to follow first. If the follow cannot be confirmed yet they are asked to try again, and the links are only sent once the follow is confirmed.
- Optionally a public reply under their comment.
- They can reply `STOP` to stop all automated messages, or `HELP` to pause the automation and get a human.

Timing rules from Instagram: the first private DM must go out within 7 days of the comment, and follow-up messages need the person's reply and must be sent within 24 hours of it.

## 5. Roles and access

A person needs both a Supabase Auth login and their lowercase email in `ADMIN_EMAILS` (changing it needs a redeploy). Removing either blocks sign-in.

An **editor** can create and edit drafts or paused campaigns, duplicate them, and resolve post links. An **approver** can also run the four Setup actions, review, activate, pause, delete drafts and archive. Editors see only the last four characters of Instagram scoped user IDs. Every server action checks the role, even where a control is hidden. See [META-SETUP.md](META-SETUP.md) for the SQL that grants roles.

## 6. Things to know

- **Connection:** the tool acts as your Instagram account through a long-lived token that refreshes itself. If `/admin` shows `reconnect_required`, generate a new token in the Meta app dashboard and run **Connect account** again.
- **Meta app mode:** it must be in Live mode; in Development mode Meta only delivers comments from app testers.
- **Emergency stop:** pause a campaign in `/admin`. To stop every send, an operator sets `settings.sends_enabled` to false in a privileged SQL session; queued sends check it right before each call.
- **Data:** commenter IDs and message events are kept for the retention period set in the database, then purged. A person can be deleted on request with `IG_USER_ID=... IGSID_TO_DELETE=... npm run delete-user`; a one-way STOP digest remains so they are never messaged again.
- **Health:** `GET /api/health` reports database, account and job-runner status.
