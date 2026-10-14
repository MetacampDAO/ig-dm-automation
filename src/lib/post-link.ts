import type { MetaClient, OwnedMedia } from './meta/client';
import { env } from './env';

export const postNotFoundMessage=():string=>`Post not found in the last 200 posts of @${env().IG_USERNAME}.`;

export function parsePostLink(input: string): { shortcode: string; permalink: string } {
  let url: URL;
  try { url=new URL(input); } catch { throw new Error('Paste a full Instagram post or Reel HTTPS link.'); }
  const match=/^\/(?:p|reel)\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
  if(url.protocol!=='https:'||!['instagram.com','www.instagram.com'].includes(url.hostname)||url.username||url.password||url.port||!match) throw new Error('Paste an instagram.com/p/ or /reel/ HTTPS link.');
  return {shortcode:match[1],permalink:`https://www.instagram.com${url.pathname.replace(/\/$/,'')}/`};
}
export async function findOwnedPost(client: Pick<MetaClient,'listMedia'>, link: string): Promise<{ media: OwnedMedia; captionLine: string }> {
  const target=parsePostLink(link);
  let after: string|undefined;
  const seen=new Set<string>();
  for(let page=0;page<4;page++) {
    const result=await client.listMedia(after);
    for(const media of result.data) { let parsed: ReturnType<typeof parsePostLink>; try { parsed=parsePostLink(media.permalink); } catch { continue; } if(parsed.shortcode===target.shortcode) return {media,captionLine:(media.caption??'').split(/\r?\n/)[0].slice(0,80)}; }
    if(!result.after||seen.has(result.after)) break;
    seen.add(result.after); after=result.after;
  }
  throw new Error(postNotFoundMessage());
}
