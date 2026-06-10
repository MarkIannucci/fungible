import { db } from './db.js';

export type HouseholdMember = { name: string; birthYear: number };

export type Profile = {
  self: HouseholdMember;
  spouse?: HouseholdMember;
  children: HouseholdMember[];
};

type MemberRow = { id: unknown; name: unknown; birth_year: unknown };

function toMember(r: MemberRow): HouseholdMember {
  return { name: String(r.name ?? ''), birthYear: Number(r.birth_year ?? 0) };
}

export async function loadProfile(): Promise<Profile | null> {
  const { rows } = await db.execute('SELECT id, name, birth_year FROM household_members ORDER BY sort_order');
  if (rows.length === 0) return null;
  const all = rows as unknown as MemberRow[];
  const selfRow = all.find((r) => r.id === 'self');
  if (!selfRow) return null;
  const spouseRow = all.find((r) => r.id === 'spouse');
  const childRows = all.filter((r) => String(r.id).startsWith('child-'));
  return {
    self: toMember(selfRow),
    spouse: spouseRow ? toMember(spouseRow) : undefined,
    children: childRows.map(toMember),
  };
}

export async function saveProfile(p: Profile): Promise<void> {
  const rows: { sql: string; args: (string | number)[] }[] = [
    { sql: 'INSERT OR REPLACE INTO household_members (id, name, birth_year, sort_order) VALUES (?,?,?,0)', args: ['self', p.self.name, p.self.birthYear] },
  ];
  if (p.spouse) {
    rows.push({ sql: 'INSERT OR REPLACE INTO household_members (id, name, birth_year, sort_order) VALUES (?,?,?,1)', args: ['spouse', p.spouse.name, p.spouse.birthYear] });
  } else {
    rows.push({ sql: 'DELETE FROM household_members WHERE id = ?', args: ['spouse'] });
  }
  rows.push({ sql: "DELETE FROM household_members WHERE id LIKE 'child-%'", args: [] });
  for (let i = 0; i < p.children.length; i++) {
    rows.push({ sql: 'INSERT INTO household_members (id, name, birth_year, sort_order) VALUES (?,?,?,?)', args: [`child-${i}`, p.children[i].name, p.children[i].birthYear, i + 2] });
  }
  await db.batch(rows, 'write');
}

// Returns ordered member names for the account owner picker. Members with no name are omitted.
export function householdMembers(p: Profile | null): string[] {
  if (!p) return [];
  const names: string[] = [];
  if (p.self.name.trim()) names.push(p.self.name.trim());
  if (p.spouse?.name.trim()) names.push(p.spouse.name.trim());
  for (const c of p.children) {
    if (c.name.trim()) names.push(c.name.trim());
  }
  return names;
}
