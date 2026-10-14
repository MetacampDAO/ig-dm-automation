const DAY = 86_400_000;
export function privateReplyAllowed(commentAt: string | Date, now = new Date()): boolean {
  const elapsed = now.getTime() - new Date(commentAt).getTime();
  return elapsed >= -30_000 && elapsed <= 7 * DAY;
}
export function messageAllowed(lastInboundAt: string | Date | null, now = new Date()): boolean {
  if (!lastInboundAt) return false;
  const elapsed = now.getTime() - new Date(lastInboundAt).getTime();
  return elapsed >= -30_000 && elapsed <= DAY;
}
