import { type Person } from './auth';

export const PLAYING_LEVELS = ['beginner', 'intermediate', 'advanced', 'pro'] as const;
export type PlayingLevel = (typeof PLAYING_LEVELS)[number];

export const LEVEL_LABELS: Record<PlayingLevel, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  pro: 'Pro',
};

export function isPlayingLevel(value: string): value is PlayingLevel {
  return PLAYING_LEVELS.includes(value as PlayingLevel);
}

export function profileComplete(user: Person): boolean {
  return Boolean(user.name?.trim() && user.kit?.trim() && user.level && isPlayingLevel(user.level));
}

export function initials(user: Person): string {
  const src = (user.name || user.email || '?').trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export function parseProfile(body: Record<string, string>): { name: string; kit: string; level: string; phone: string; error?: string } {
  const name = (body.name || '').trim().slice(0, 80);
  const kit = (body.kit || '').trim().slice(0, 200);
  const level = (body.level || '').trim();
  const phone = (body.phone || '').trim().slice(0, 40);
  if (!name) return { name, kit, level, phone, error: 'Name is required.' };
  if (!kit) return { name, kit, level, phone, error: 'Tell us about your kit.' };
  if (!isPlayingLevel(level)) return { name, kit, level, phone, error: 'Pick a playing level.' };
  return { name, kit, level, phone };
}

export async function saveProfile(db: D1Database, personId: string, fields: { name: string; kit: string; level: string; phone: string }): Promise<void> {
  await db
    .prepare('UPDATE people SET name = ?, kit = ?, level = ?, phone = ? WHERE id = ?')
    .bind(fields.name, fields.kit, fields.level, fields.phone, personId)
    .run();
}

export function levelSelect(id: string, current = '', required = true): string {
  const opts = PLAYING_LEVELS.map(
    (l) => `<option value="${l}" ${current === l ? 'selected' : ''}>${LEVEL_LABELS[l]}</option>`,
  ).join('');
  return `<select id="${id}" name="level" ${required ? 'required' : ''}>
    <option value="" ${current ? '' : 'selected'} ${required ? 'disabled' : ''}>${required ? 'Pick a level' : 'not set'}</option>
    ${opts}
  </select>`;
}
