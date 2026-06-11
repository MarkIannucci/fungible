import React, { useRef, useState } from 'react';
import { api } from '../api.js';
import { useQuery } from '../hooks/useQuery.js';
import { useStatus } from '../hooks/useStatus.js';
import { useNav } from '../hooks/useNav.js';
import { useScreenKeys } from '../hooks/useScreenKeys.js';
import { KeyHints } from '../components/KeyHints.js';
import { Modal } from '../components/Modal.js';
import { fmt, fmtSigned } from '../../../../core/fmt.js';
import type { Tag } from '../../../../core/queries.js';
import styles from './Tags.module.css';

export function Tags() {
  const { txFilter, navigate } = useNav();
  const { showStatus, statusEl } = useStatus();
  const [search, setSearch] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  const tags = useQuery(() => api.queries.getAllTags(), [reloadKey]) ?? [];
  const [selectedName, setSelectedName] = useState<string | null>(txFilter.tag ?? null);
  const [addOpen, setAddOpen] = useState(false);
  const [renameTag, setRenameTag] = useState<Tag | null>(null);

  const visibleTags = search ? tags.filter((t) => t.name.toLowerCase().includes(search.toLowerCase())) : tags;
  const selected = tags.find((t) => t.name.toLowerCase() === selectedName?.toLowerCase()) ?? null;

  const summary = useQuery(
    () => (selected ? api.queries.getTagSummary(selected.name) : Promise.resolve(null)),
    [selected?.name, reloadKey],
  );

  const searchRef = useRef<HTMLInputElement>(null);
  useScreenKeys({
    '/': () => searchRef.current?.focus(),
    a: () => setAddOpen(true),
    t: () => {
      if (selected) navigate('transactions', { tag: selected.name });
    },
    Escape: () => {
      if (search) setSearch('');
      else if (selected) setSelectedName(null);
      else navigate('dashboard');
    },
  });
  const maxCategorySpend = summary?.byCategory[0]?.total ?? 1;

  return (
    <div className={styles.screen}>
      <KeyHints hints="[1-9·0] screens   [/] filter   [a] add tag   [t] tag's transactions   [esc] back" />
      <div className={styles.topBar}>
        <h1 className={styles.title}>Tags</h1>
        <input
          ref={searchRef}
          className={styles.search}
          placeholder="Filter tags…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSearch('');
              searchRef.current?.blur();
            }
          }}
        />
        <button className={styles.addBtn} onClick={() => setAddOpen(true)}>
          + New tag
        </button>
      </div>

      <div className={styles.columns}>
        <section className={styles.panel}>
          {visibleTags.length === 0 ? (
            <p className="dim">{search ? `No tags matching "${search}".` : 'No tags yet — create one, or tag transactions directly.'}</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Tag</th>
                  <th className={styles.th}>Txns</th>
                  <th className={styles.th}>Inflow</th>
                  <th className={styles.th}>Outflow</th>
                  <th className={styles.th} />
                </tr>
              </thead>
              <tbody>
                {visibleTags.map((t) => (
                  <tr
                    key={t.id}
                    className={selected?.id === t.id ? styles.rowActive : styles.row}
                    onClick={() => setSelectedName(t.name)}
                  >
                    <td className={styles.tdName}>{t.name}</td>
                    <td className="num dim">{t.count}</td>
                    <td className="num pos">{fmt(t.inflow)}</td>
                    <td className="num neg">{fmt(t.outflow)}</td>
                    <td className={styles.tdActions}>
                      <button
                        className={styles.rowBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenameTag(t);
                        }}
                      >
                        rename
                      </button>
                      <button
                        className={`${styles.rowBtn} ${styles.rowBtnDanger}`}
                        onClick={async (e) => {
                          e.stopPropagation();
                          await api.tags.deleteTag(t.id);
                          if (selected?.id === t.id) setSelectedName(null);
                          showStatus(`Deleted "${t.name}"`);
                          reload();
                        }}
                      >
                        delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className={styles.panel}>
          {!selected ? (
            <p className="dim">Select a tag to see its breakdown.</p>
          ) : (
            <>
              <div className={styles.detailHeader}>
                <h2>
                  <span className="accent"># {selected.name}</span>
                </h2>
                <button className={styles.rowBtnVisible} onClick={() => navigate('transactions', { tag: selected.name })}>
                  all transactions →
                </button>
              </div>
              {summary && (
                <>
                  <div className={styles.statRow}>
                    <div>
                      <div className={styles.statLabel}>Income</div>
                      <div className="num pos">{fmt(summary.income)}</div>
                    </div>
                    <div>
                      <div className={styles.statLabel}>Expenses</div>
                      <div className="num neg">{fmt(summary.expenses)}</div>
                    </div>
                    <div>
                      <div className={styles.statLabel}>Net</div>
                      <div className={`num ${summary.net >= 0 ? 'pos' : 'neg'}`}>{fmtSigned(summary.net)}</div>
                    </div>
                    <div>
                      <div className={styles.statLabel}>Txns</div>
                      <div className="num">{selected.count}</div>
                    </div>
                  </div>
                  <h3 className={styles.sectionLabel}>Spending by category</h3>
                  {summary.byCategory.length === 0 ? (
                    <p className="dim">No expense data for this tag.</p>
                  ) : (
                    <table className={styles.table}>
                      <tbody>
                        {summary.byCategory.map((row) => (
                          <tr
                            key={row.category}
                            className={styles.row}
                            onClick={() => navigate('transactions', { tag: selected.name, category: row.category })}
                          >
                            <td className={styles.tdName}>{row.category}</td>
                            <td className="num warn">{fmt(row.total)}</td>
                            <td className={styles.tdBar}>
                              <div className={styles.barTrack}>
                                <div
                                  className={styles.barFill}
                                  style={{ width: `${Math.min(100, (row.total / maxCategorySpend) * 100)}%` }}
                                />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>

      {addOpen && (
        <NameModal
          title="New tag"
          initial=""
          onClose={() => setAddOpen(false)}
          onSave={async (name) => {
            await api.tags.createTag(name);
            setAddOpen(false);
            showStatus(`Created "${name}"`);
            reload();
          }}
        />
      )}

      {renameTag && (
        <NameModal
          title={`Rename "${renameTag.name}"`}
          initial={renameTag.name}
          onClose={() => setRenameTag(null)}
          onSave={async (name) => {
            await api.tags.renameTag(renameTag.id, name);
            if (selectedName === renameTag.name) setSelectedName(name);
            setRenameTag(null);
            showStatus('Tag renamed');
            reload();
          }}
        />
      )}

      {statusEl}
    </div>
  );
}

function NameModal({
  title,
  initial,
  onClose,
  onSave,
}: {
  title: string;
  initial: string;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <Modal title={title} onClose={onClose}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) onSave(name.trim());
        }}
        placeholder="Tag name"
        autoFocus
        className={styles.modalInput}
      />
      <div className={styles.modalActions}>
        <button className={styles.btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button className={styles.btnPrimary} onClick={() => name.trim() && onSave(name.trim())} disabled={!name.trim()}>
          Save
        </button>
      </div>
    </Modal>
  );
}
