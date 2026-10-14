alter table campaigns add column comment_reply_text text check (comment_reply_text is null or (char_length(comment_reply_text) <= 300 and btrim(comment_reply_text) <> '' and comment_reply_text !~* 'https?://'));
comment on column campaigns.comment_reply_text is 'Optional public reply sent after a successful private reply; NULL disables it. Nonblank, URL-free text is limited to 300 characters.';
