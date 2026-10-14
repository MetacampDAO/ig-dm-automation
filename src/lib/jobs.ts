import type { Repository } from './repository';
import { dispatchAction } from './actions';
import { processRecheck, processEvent } from './flow';
import { refreshDueTokens } from './tokens';
import { processStoredEvent } from './process';

export async function runJobs(repo: Repository, now = Date.now()): Promise<{ events: number; actions: number; rechecks: number; replayed: number }> {
  const deadline = now + 25_000;
  let events = 0, actions = 0, rechecks = 0, replayed = 0;
  for (const event of await repo.dueEvents()) {
    if (Date.now() > deadline - 10_000) break;
    try { await processStoredEvent(repo, event.id); }
    catch (error) { await repo.audit('system', 'event_retry_failed', event.id, { message: error instanceof Error ? error.message : String(error) }); }
    events++;
  }
  try { await repo.reconcileExpiredSends(); }
  catch (error) { await repo.audit('system', 'reconcile_job_failed', 'outbound_actions', { message: error instanceof Error ? error.message : String(error) }); }
  for (const action of await repo.dueActions(10)) {
    if (Date.now() > deadline - 10_000) break;
    try { await dispatchAction(repo, action.id); }
    catch (error) { await repo.audit('system', 'action_job_failed', action.id, { message: error instanceof Error ? error.message : String(error) }); }
    actions++;
  }
  for (const id of await repo.dueRechecks()) {
    if (Date.now() > deadline - 10_000) break;
    try { if (!await repo.claimRecheck(id)) continue; await processRecheck(repo, id); }
    catch (error) { await repo.audit('system', 'recheck_job_failed', id, { message: error instanceof Error ? error.message : String(error) }); }
    rechecks++;
  }
  for (const event of await repo.dueUnmatched()) {
    if (Date.now() > deadline - 10_000) break;
    try { await processEvent(repo, event); }
    catch (error) { await repo.audit('system', 'unmatched_replay_failed', event.id, { message: error instanceof Error ? error.message : String(error) }); }
    finally { await repo.deleteUnmatched(event.id); }
    replayed++;
  }
  if (Date.now() < deadline - 10_000) { try { await refreshDueTokens(); } catch (error) { await repo.audit('system', 'token_refresh_job_failed', 'accounts', { message: error instanceof Error ? error.message : String(error) }); } }
  if (Date.now() < deadline - 10_000) { try { await repo.purge(); } catch (error) { await repo.audit('system', 'purge_job_failed', 'retention', { message: error instanceof Error ? error.message : String(error) }); } }
  return { events, actions, rechecks, replayed };
}
