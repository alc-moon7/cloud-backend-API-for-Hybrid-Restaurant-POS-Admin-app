const priority: Record<string, number> = {
  pending: 0,
  accepted: 1,
  preparing: 2,
  ready: 3,
  served: 4,
  cancelled: 99,
};

export const orderStatuses = Object.keys(priority);

export function canTransitionOrderStatus(current: string, next: string) {
  if (current === next) return true;
  if (current === 'served') return next === 'served';
  if (next === 'cancelled') return current !== 'served';
  if (current === 'cancelled') return next === 'cancelled';
  return priority[next] >= priority[current];
}
