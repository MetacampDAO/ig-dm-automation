'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { connectAccountFromEnv, scheduleJobRunner, seedDraftCampaign, subscribeWebhooks } from './setup-actions';

type Key = 'connect' | 'seed' | 'subscribe' | 'schedule';
const labels: Record<Key, string> = {
  connect: 'Connect account', seed: 'Seed draft campaign', subscribe: 'Subscribe webhooks', schedule: 'Schedule job runner',
};
export function SetupSection() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<Key | null>(null);
  const [results, setResults] = useState<Partial<Record<Key, { ok: boolean; message: string }>>>({});
  function run(key: Key) {
    setRunning(key);
    startTransition(async () => {
      try {
        let update: { ok: boolean; message: string };
        if (key === 'connect') {
          const response = await connectAccountFromEnv();
          update = response.ok ? { ok: true, message: `${response.result.username} (${response.result.ig_user_id}); expires ${response.result.expires_at}` } : { ok: false, message: response.error };
        } else if (key === 'seed') {
          const response = await seedDraftCampaign();
          update = response.ok ? { ok: true, message: response.result.created ? `${response.result.name} draft created (${response.result.id}).` : `${response.result.name} already exists (${response.result.id}); left unchanged.` } : { ok: false, message: response.error };
        } else if (key === 'subscribe') {
          const response = await subscribeWebhooks();
          update = response.ok ? { ok: true, message: `Readback fields: ${response.result.subscribed_fields.join(', ') || 'none'}` } : { ok: false, message: response.error };
        } else {
          const response = await scheduleJobRunner();
          update = response.ok ? { ok: true, message: `${response.result.jobname}: ${response.result.schedule}; active ${response.result.active ? 'yes' : 'no'}` } : { ok: false, message: response.error };
        }
        setResults((current) => ({ ...current, [key]: update }));
        if (update.ok) router.refresh();
      } catch {
        setResults((current) => ({ ...current, [key]: { ok: false, message: 'Request failed. Sign in again or check the server logs.' } }));
      } finally { setRunning(null); }
    });
  }
  return <section><h2>Setup</h2><p>Run these steps in order after setting the production environment and signing in.</p><div className="setup-actions">
    {(Object.keys(labels) as Key[]).map((key) => <div className="setup-action" key={key}>
      <button type="button" onClick={() => run(key)} disabled={pending}>{running === key ? 'Working…' : labels[key]}</button>
      {results[key] && <span role="status" className={results[key]?.ok ? 'setup-success' : 'setup-error'}>{results[key]?.message}</span>}
    </div>)}
  </div></section>;
}
