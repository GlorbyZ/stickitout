import type { Person } from './auth';

export type Tier = 'free' | 'member' | 'pro';

/**
 * One place decides what a person can reach. When the pro plan ships,
 * add its Stripe plan name here and nothing else changes.
 */
export function entitlement(person: Pick<Person, 'status' | 'plan'>): Tier {
  const status = (person.status || '').toLowerCase();
  if (status === 'founding' || status === 'active') return 'member';
  return 'free';
}

export function allowedTiers(person: Pick<Person, 'status' | 'plan'>): Tier[] {
  const level = entitlement(person);
  if (level === 'pro') return ['free', 'member', 'pro'];
  if (level === 'member') return ['free', 'member'];
  return ['free'];
}

/** Logging sessions and running the metronome needs a paid membership. */
export function canPractice(person: Pick<Person, 'status' | 'plan'>): boolean {
  const status = (person.status || '').toLowerCase();
  return status === 'founding' || status === 'active';
}

export function tierLocked(person: Pick<Person, 'status' | 'plan'>, tier: string): boolean {
  return !allowedTiers(person).includes((tier || 'free') as Tier);
}

export function lockReason(person: Pick<Person, 'status' | 'plan'>, tier: string): string {
  if (!tierLocked(person, tier)) return '';
  if (tier === 'pro') return 'Coming with the next plan';
  return 'Unlocks with membership';
}
