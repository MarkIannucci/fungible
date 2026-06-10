// Shared, multi-dimension transaction filter used across the Dashboard,
// Transactions, and Trends views. The four dimensions AND together; within a
// dimension the selected members OR together.
//
// Semantics of each dimension on the query side:
//   - absent (undefined)  → no constraint (all)
//   - present, non-empty   → restrict to those members
//   - present, empty array → match nothing (the user explicitly cleared it)
//
// The panel UI works with an explicit "selected" set initialized to the full
// universe and serializes "everything selected" back to `undefined`, so a
// fully-selected section imposes no constraint.

export type TagPredicate = { name: string; mode: 'has' | 'lacks' };

export type Filter = {
  categories?: string[];
  accounts?: string[];   // account ids
  owners?: string[];     // owner names ('Unassigned' for accounts with no owner)
  tags?: TagPredicate[];
};

export const EMPTY_FILTER: Filter = {};

/** Whether the filter constrains anything (used to show/hide the header hint). */
export function isFilterActive(f?: Filter): boolean {
  if (!f) return false;
  return f.categories !== undefined
    || f.accounts !== undefined
    || f.owners !== undefined
    || (f.tags?.length ?? 0) > 0;
}

/** Compact one-line description of the active filter, e.g. "2 accounts, 4 categories". */
export function filterSummary(f?: Filter): string {
  if (!f) return '';
  const parts: string[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (f.accounts) parts.push(plural(f.accounts.length, 'account', 'accounts'));
  if (f.categories) parts.push(plural(f.categories.length, 'category', 'categories'));
  if (f.owners) parts.push(plural(f.owners.length, 'owner', 'owners'));
  if (f.tags?.length) parts.push(plural(f.tags.length, 'tag', 'tags'));
  return parts.join(', ');
}

/**
 * AND two filters together — used to layer a screen's local/scoped filter on
 * top of the shared one. For the set-valued dimensions the result is the
 * intersection (a row must satisfy both); tag predicates concatenate (all must
 * hold). When only one side constrains a dimension, that side wins.
 */
export function mergeFilters(base: Filter | undefined, extra: Filter | undefined): Filter {
  if (!base) return extra ?? {};
  if (!extra) return base;
  const out: Filter = {};
  for (const dim of ['categories', 'accounts', 'owners'] as const) {
    const a = base[dim];
    const b = extra[dim];
    if (a !== undefined && b !== undefined) out[dim] = a.filter((v) => b.includes(v));
    else if (a !== undefined) out[dim] = a;
    else if (b !== undefined) out[dim] = b;
  }
  const tags = [...(base.tags ?? []), ...(extra.tags ?? [])];
  if (tags.length) out.tags = tags;
  return out;
}

/**
 * Builds the SQL condition fragments + bound args that restrict rows by the
 * filter. `alias` is the alias (or table name) of the transactions row the
 * conditions reference — 't' in aliased queries, 'transactions' in unaliased
 * ones. Tag predicates correlate an EXISTS subquery against `${alias}.id`.
 */
export function buildFilterConditions(
  filter: Filter | undefined,
  alias: string,
): { conditions: string[]; args: string[] } {
  if (!filter) return { conditions: [], args: [] };
  const conditions: string[] = [];
  const args: string[] = [];

  const inList = (col: string, values: string[]) => {
    if (values.length === 0) { conditions.push('1 = 0'); return; }
    conditions.push(`${col} IN (${values.map(() => '?').join(', ')})`);
    args.push(...values);
  };

  if (filter.categories !== undefined) inList(`${alias}.category`, filter.categories);
  if (filter.accounts !== undefined) inList(`${alias}.account_id`, filter.accounts);
  if (filter.owners !== undefined) {
    if (filter.owners.length === 0) {
      conditions.push('1 = 0');
    } else {
      const ph = filter.owners.map(() => '?').join(', ');
      conditions.push(
        `${alias}.account_id IN (SELECT id FROM accounts WHERE COALESCE(NULLIF(TRIM(owner), ''), 'Unassigned') IN (${ph}))`,
      );
      args.push(...filter.owners);
    }
  }
  for (const t of filter.tags ?? []) {
    const exists = `EXISTS (SELECT 1 FROM transaction_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.transaction_id = ${alias}.id AND tg.name = ?)`;
    conditions.push(t.mode === 'has' ? exists : `NOT ${exists}`);
    args.push(t.name);
  }

  return { conditions, args };
}

/**
 * Same as {@link buildFilterConditions} but returns a single clause ready to
 * splice after an existing WHERE — prefixed with ` AND ` (or empty when the
 * filter imposes no constraint).
 */
export function buildFilterClause(
  filter: Filter | undefined,
  alias: string,
): { clause: string; args: string[] } {
  const { conditions, args } = buildFilterConditions(filter, alias);
  return { clause: conditions.length ? ' AND ' + conditions.join(' AND ') : '', args };
}
