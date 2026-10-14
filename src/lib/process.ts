import type { Repository } from './repository';
import { processEvent } from './flow';

export async function processStoredEvent(repo: Repository, id: string): Promise<void> {
  const event = await repo.claimEvent(id);
  if (!event) return;
  try { await processEvent(repo, event); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await repo.finishEvent(id, message);
    throw error;
  }
}
