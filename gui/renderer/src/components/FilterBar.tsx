import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useFilter } from '../hooks/useFilter.js';
import { Modal } from './Modal.js';
import {
  EMPTY_FILTER,
  isFilterActive,
  filterSummary,
  type Filter,
  type TagPredicate,
} from '../../../../core/filters.js';
import styles from './FilterBar.module.css';

export function FilterBar() {
  const { filter, setFilter } = useFilter();
  const [open, setOpen] = useState(false);
  const active = isFilterActive(filter);

  return (
    <div className={styles.bar}>
      <button className={active ? styles.filterBtnActive : styles.filterBtn} onClick={() => setOpen(true)}>
        ⚲ Filter{active ? `: ${filterSummary(filter)}` : ''}
      </button>
      {active && (
        <button className={styles.clearBtn} onClick={() => setFilter(EMPTY_FILTER)}>
          clear
        </button>
      )}
      <span className={`dim ${styles.hint}`}>applies to Dashboard, Transactions & Trends</span>
      {open && <FilterPanel filter={filter} onApply={(f) => { setFilter(f); setOpen(false); }} onClose={() => setOpen(false)} />}
    </div>
  );
}

type TagMode = 'has' | 'lacks' | null;

function FilterPanel({
  filter,
  onApply,
  onClose,
}: {
  filter: Filter;
  onApply: (f: Filter) => void;
  onClose: () => void;
}) {
  const [categories, setCategories] = useState<string[] | null>(null);
  const [accounts, setAccounts] = useState<Array<{ id: string; label: string }> | null>(null);
  const [owners, setOwners] = useState<string[] | null>(null);
  const [tagNames, setTagNames] = useState<string[] | null>(null);

  const [selCats, setSelCats] = useState<Set<string>>(new Set());
  const [selAccts, setSelAccts] = useState<Set<string>>(new Set());
  const [selOwners, setSelOwners] = useState<Set<string>>(new Set());
  const [tagModes, setTagModes] = useState<Map<string, TagMode>>(new Map());

  // Load universes, then initialize drafts: an absent dimension means
  // "everything selected" (no constraint) per core/filters.ts semantics.
  useEffect(() => {
    void Promise.all([
      api.queries.getAllCategories(),
      api.queries.getLinkedAccounts(),
      api.profile.getHouseholdMembers(),
      api.tags.getTagOptions(),
    ]).then(([cats, accts, members, tags]) => {
      const acctOptions = accts.map((a) => ({ id: a.id, label: a.nickname ?? a.name }));
      const ownerOptions = [...members, 'Unassigned'];
      setCategories(cats);
      setAccounts(acctOptions);
      setOwners(ownerOptions);
      setTagNames(tags.map((t) => t.name));

      setSelCats(new Set(filter.categories ?? cats));
      setSelAccts(new Set(filter.accounts ?? acctOptions.map((a) => a.id)));
      setSelOwners(new Set(filter.owners ?? ownerOptions));
      setTagModes(new Map((filter.tags ?? []).map((t: TagPredicate) => [t.name, t.mode])));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function apply() {
    if (!categories || !accounts || !owners) return;
    const dim = <T,>(selected: Set<T>, universe: T[]): T[] | undefined =>
      selected.size === universe.length ? undefined : [...selected];
    const tags: TagPredicate[] = [...tagModes.entries()]
      .filter(([, mode]) => mode !== null)
      .map(([name, mode]) => ({ name, mode: mode as 'has' | 'lacks' }));
    onApply({
      ...(dim(selCats, categories) !== undefined ? { categories: dim(selCats, categories) } : {}),
      ...(dim(selAccts, accounts.map((a) => a.id)) !== undefined
        ? { accounts: dim(selAccts, accounts.map((a) => a.id)) }
        : {}),
      ...(dim(selOwners, owners) !== undefined ? { owners: dim(selOwners, owners) } : {}),
      ...(tags.length ? { tags } : {}),
    });
  }

  function toggle<T>(set: Set<T>, value: T, update: (s: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
  }

  function section<T>(
    title: string,
    universe: T[],
    selected: Set<T>,
    update: (s: Set<T>) => void,
    label: (v: T) => string,
    key: (v: T) => string,
  ) {
    return (
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3>{title}</h3>
          <span className={styles.sectionBtns}>
            <button onClick={() => update(new Set(universe))}>all</button>
            <button onClick={() => update(new Set())}>none</button>
          </span>
        </div>
        <div className={styles.checkGrid}>
          {universe.map((v) => (
            <label key={key(v)} className={styles.check}>
              <input type="checkbox" checked={selected.has(v)} onChange={() => toggle(selected, v, update)} />
              {label(v)}
            </label>
          ))}
        </div>
      </div>
    );
  }

  const loaded = categories && accounts && owners && tagNames;

  return (
    <Modal title="Filter" onClose={onClose}>
      {!loaded ? (
        <p className="dim">Loading…</p>
      ) : (
        <>
          {section('Categories', categories, selCats, setSelCats, (c) => c, (c) => c)}
          {accounts.length > 0 &&
            section('Accounts', accounts.map((a) => a.id), selAccts, setSelAccts,
              (id) => accounts.find((a) => a.id === id)?.label ?? id, (id) => id)}
          {owners.length > 1 && section('Owners', owners, selOwners, setSelOwners, (o) => o, (o) => o)}

          {tagNames.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <h3>Tags</h3>
                <span className={`dim ${styles.tagHint}`}>click to cycle: any → has → lacks</span>
              </div>
              <div className={styles.tagRow}>
                {tagNames.map((name) => {
                  const mode = tagModes.get(name) ?? null;
                  return (
                    <button
                      key={name}
                      className={mode === 'has' ? styles.tagHas : mode === 'lacks' ? styles.tagLacks : styles.tagAny}
                      onClick={() =>
                        setTagModes((prev) => {
                          const next = new Map(prev);
                          next.set(name, mode === null ? 'has' : mode === 'has' ? 'lacks' : null);
                          return next;
                        })
                      }
                    >
                      {mode === 'has' ? '✓ ' : mode === 'lacks' ? '✗ ' : ''}
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className={styles.actions}>
            <button className={styles.btnSecondary} onClick={onClose}>
              Cancel
            </button>
            <button className={styles.btnPrimary} onClick={apply}>
              Apply
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
