import path from 'node:path';
import fs from 'node:fs';
import { DATA_DIR } from './paths.js';

const PROFILE_PATH = path.join(DATA_DIR, 'profile.json');

export type HouseholdMember = { name: string; birthYear: number };

export type Profile = {
  self: HouseholdMember;
  spouse?: HouseholdMember;
  children: HouseholdMember[];
};

export function loadProfile(): Profile | null {
  try {
    return JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8')) as Profile;
  } catch {
    return null;
  }
}

export function saveProfile(p: Profile): void {
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(p, null, 2), 'utf8');
}

/**
 * The named household members an account can be assigned to as its owner —
 * self, spouse, then each child, in that order. Used to populate the owner
 * picker so the stored owner name comes from a known set rather than free text.
 * Members without a name are omitted.
 */
export function householdMembers(p: Profile | null): string[] {
  if (!p) return [];
  const names: string[] = [];
  if (p.self.name.trim()) names.push(p.self.name.trim());
  if (p.spouse && p.spouse.name.trim()) names.push(p.spouse.name.trim());
  for (const c of p.children) {
    if (c.name.trim()) names.push(c.name.trim());
  }
  return names;
}
