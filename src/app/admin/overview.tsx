import * as React from 'react';
import type { Account, ConnectionHealth } from '@/lib/repository';
export function RoleBanner({bootstrap}:{bootstrap:boolean}) { return bootstrap?<p role="status" className="banner">No roles configured: everyone is an approver. Insert roles to enable editor/approver split.</p>:null; }
export function ConnectionPanel({accounts,health,mock}:{accounts:Account[];health:ConnectionHealth;mock:boolean}) {
  const display=(value:string|null|undefined)=>mock?'not tested':value??'not tested';
  return <section><h2>Connection</h2><table><tbody><tr><th>Account state</th><td>{accounts.map((a)=>`${a.username}: ${mock?'not tested':a.state}`).join(', ')||'not tested'}</td></tr><tr><th>Token expiry</th><td>{accounts.map((a)=>display(a.token_expires_at)).join(', ')||'not tested'}</td></tr><tr><th>Last webhook received</th><td>{display(health.last_webhook_at)}</td></tr><tr><th>Last sent action</th><td>{display(health.last_sent_at)}</td></tr><tr><th>Last failed or uncertain action</th><td>{mock?'not tested':health.last_error?`${health.last_error.at} · ${health.last_error.state} · ${health.last_error.error_code??'no code'}`:'not tested'}</td></tr><tr><th>Job runner active</th><td>{mock?'not tested':health.job_runner_active===null?'not tested':health.job_runner_active?'yes':'no'}</td></tr></tbody></table></section>;
}
