import React, { useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useQuery } from '../hooks/useQuery.js';
import { useNav } from '../hooks/useNav.js';
import { useScreenKeys } from '../hooks/useScreenKeys.js';
import { KeyHints } from '../components/KeyHints.js';
import { fmt, fmtSigned } from '../../../../core/fmt.js';
import {
  getPeriodStart,
  getPeriodDates,
  navigatePeriod,
  formatPeriodLabel,
  getDriftWindows,
  RANGES,
  RANGE_LABELS,
  type Range,
} from '../../../../core/dateUtils.js';
import type { AccountRow, CategoryDrift, FlexSummary } from '../../../../core/queries.js';
import { mergeFilters, type Filter } from '../../../../core/filters.js';
import { useFilter } from '../hooks/useFilter.js';
import type { TxFilter } from '../../../shared/nav.js';
import styles from './Dashboard.module.css';

type DashView = 'categories' | 'flex' | 'account' | 'owner';

const FLEX_TIERS: Array<{ key: keyof FlexSummary; label: string; cssVar: string }> = [
  { key: 'fixed', label: 'Fixed', cssVar: 'var(--flex-fixed)' },
  { key: 'flexible', label: 'Flexible', cssVar: 'var(--flex-flexible)' },
  { key: 'discretionary', label: 'Discretionary', cssVar: 'var(--flex-discretionary)' },
  { key: 'untagged', label: 'Untagged', cssVar: 'var(--text-dim)' },
];

function pct(part: number, total: number) {
  return total === 0 ? '0%' : `${Math.round((part / total) * 100)}%`;
}

/** Heat-map class based on current spend vs 12-month rolling average (mirrors TUI driftColor). */
function driftClass(current: number, avg12m: number): string {
  if (current === 0) return '';
  if (avg12m === 0) return 'neg'; // new spending with no history
  const ratio = current / avg12m;
  if (ratio <= 1.1) return 'pos';
  if (ratio <= 1.3) return 'warn';
  return 'neg';
}

function fmtDelta(delta: number): string {
  return delta === 0 ? '—' : fmtSigned(delta, 0);
}

function Bar({ value, max, color }: { value: number; max: number; color?: string }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={styles.barTrack}>
      <div className={styles.barFill} style={{ width: `${w}%`, background: color ?? 'var(--accent)' }} />
    </div>
  );
}

type DriftSortCol = 'category' | 'current' | 'lastPeriodDelta' | 'lastYearDelta' | 'avg12mDelta';

export function Dashboard() {
  const { txFilter, navigate } = useNav();
  const now = useMemo(() => new Date(), []);

  const initialRange: Range =
    txFilter.range && (RANGES as string[]).includes(txFilter.range) ? (txFilter.range as Range) : 'month';
  const [range, setRange] = useState<Range>(initialRange);
  const [anchor, setAnchor] = useState<Date>(() => {
    if (txFilter.anchor && /^\d{4}-\d{2}-\d{2}$/.test(txFilter.anchor)) {
      const [y, m, d] = txFilter.anchor.split('-').map(Number);
      return getPeriodStart(initialRange, new Date(y, m - 1, d));
    }
    return getPeriodStart(initialRange, now);
  });
  const [view, setView] = useState<DashView>('categories');
  const [driftMode, setDriftMode] = useState(false);
  const [searchInput, setSearchInput] = useState(txFilter.search ?? '');
  const [search, setSearch] = useState(txFilter.search ?? '');
  const [selectedAccount, setSelectedAccount] = useState<AccountRow | null>(null);
  const [merchantDrill, setMerchantDrill] = useState<string | null>(null); // category name
  const [driftSort, setDriftSort] = useState<{ col: DriftSortCol; desc: boolean }>({ col: 'current', desc: true });

  const { from, to } = getPeriodDates(range, anchor);
  const { filter: sharedFilter, setFilter } = useFilter();
  const acctId = selectedAccount?.id;
  const filter: Filter = mergeFilters(sharedFilter, acctId ? { accounts: [acctId] } : undefined);

  // Drill-in writes the sticky shared filter (replace those dimensions),
  // keeping the date range / search as transient nav params.
  function drillToTransactions(dims: Partial<Filter>, nav: Partial<TxFilter> = {}) {
    setFilter({
      ...sharedFilter,
      ...(selectedAccount ? { accounts: [selectedAccount.id] } : {}),
      ...dims,
    });
    navigate('transactions', { from, to, range, anchor: from, drillFrom: 'dashboard', ...nav });
  }

  const bounds = useQuery(() => api.queries.getDataBounds(), []);
  const summary = useQuery(() => api.queries.getRangeSummary(from, to, filter), [from, to, acctId, sharedFilter]);
  const flexData = useQuery(() => api.queries.getFlexSummary(from, to, filter), [from, to, acctId, sharedFilter]);
  const uncategorized = useQuery(() => api.queries.getUncategorizedCount(from, to, filter), [from, to, acctId, sharedFilter]);
  const accountRows = useQuery(() => api.queries.getAccountRows(from, to, filter), [from, to, acctId, sharedFilter]);
  const ownerRows = useQuery(() => api.queries.getOwnerRows(from, to, filter), [from, to, acctId, sharedFilter]);

  const driftWindows = driftMode ? getDriftWindows(range, anchor, new Date()) : null;
  const catDrift = useQuery(
    () =>
      driftWindows
        ? api.queries.getCategoryDriftData(driftWindows.current, driftWindows.lastPeriod, driftWindows.lastYear, driftWindows.rolling12, filter)
        : Promise.resolve(null),
    [driftMode, from, to, acctId, sharedFilter],
  );
  const flexDrift = useQuery(
    () =>
      driftWindows
        ? api.queries.getFlexDriftData(driftWindows.current, driftWindows.lastPeriod, driftWindows.lastYear, driftWindows.rolling12, filter)
        : Promise.resolve(null),
    [driftMode, from, to, acctId, sharedFilter],
  );
  const acctDrift = useQuery(
    () =>
      driftWindows
        ? api.queries.getAccountDriftData(driftWindows.current, driftWindows.lastPeriod, driftWindows.lastYear, driftWindows.rolling12)
        : Promise.resolve(null),
    [driftMode, from, to],
  );

  const searchStats = useQuery(
    () => (searchInput ? api.queries.countSearchMatches(from, to, searchInput, filter) : Promise.resolve(null)),
    [searchInput, from, to, acctId, sharedFilter],
  );
  const filtered = useQuery(
    () => (search ? api.queries.getSearchFilteredData(from, to, search, filter) : Promise.resolve(null)),
    [search, from, to, acctId, sharedFilter],
  );
  const merchantRows = useQuery(
    () => (merchantDrill ? api.queries.getMerchantSummary(merchantDrill, from, to, filter) : Promise.resolve(null)),
    [merchantDrill, from, to, acctId, sharedFilter],
  );

  const displaySummary = filtered?.summary ?? summary;
  const displayFlex = filtered?.flexData ?? flexData;
  const categories = displaySummary?.byCategory ?? [];
  const maxCategorySpend = categories[0]?.total ?? 1;
  const totalExpenses = displaySummary?.expenses ?? 0;
  const hasOwners = (ownerRows ?? []).some((r) => r.owner !== 'Unassigned');
  const maxOwnerSpend = ownerRows?.[0]?.spending ?? 1;

  const sortedDrift = useMemo(() => {
    if (!catDrift) return null;
    const { col, desc } = driftSort;
    return [...catDrift].sort((a, b) => {
      const av = a[col];
      const bv = b[col];
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return desc ? -cmp : cmp;
    });
  }, [catDrift, driftSort]);

  function goPeriod(delta: -1 | 1) {
    if (range === 'alltime') return;
    const next = navigatePeriod(range, anchor, delta);
    const { from: nextFrom } = getPeriodDates(range, next);
    if (delta < 0 && bounds && nextFrom < bounds.minDate) return;
    if (delta > 0 && bounds && nextFrom > bounds.maxDate) return;
    setAnchor(next);
  }

  function pickRange(r: Range) {
    setRange(r);
    setAnchor(getPeriodStart(r, now));
  }

  function driftHeader(col: DriftSortCol, label: string) {
    const active = driftSort.col === col;
    return (
      <th
        className={active ? styles.thActive : styles.th}
        onClick={() => setDriftSort((s) => ({ col, desc: s.col === col ? !s.desc : true }))}
      >
        {label} {active ? (driftSort.desc ? '↓' : '↑') : ''}
      </th>
    );
  }

  const views: DashView[] = hasOwners
    ? ['categories', 'flex', 'account', 'owner']
    : ['categories', 'flex', 'account'];
  const VIEW_LABELS: Record<DashView, string> = {
    categories: 'Categories',
    flex: 'Flexibility',
    account: 'Accounts',
    owner: 'Owners',
  };

  const searchRef = useRef<HTMLInputElement>(null);
  useScreenKeys({
    r: () => {
      const idx = RANGES.indexOf(range);
      pickRange(RANGES[(idx + 1) % RANGES.length]);
    },
    d: () => setDriftMode((m) => !m),
    Tab: () => {
      setMerchantDrill(null);
      setView((v) => views[(views.indexOf(v) + 1) % views.length]);
    },
    ArrowLeft: () => goPeriod(-1),
    ArrowRight: () => goPeriod(1),
    '/': () => searchRef.current?.focus(),
    Escape: () => {
      if (merchantDrill) setMerchantDrill(null);
      else {
        setSearch('');
        setSearchInput('');
      }
    },
  });

  return (
    <div className={styles.screen}>
      <KeyHints hints="[1-9·0] screens   [r] range   [d] delta   [tab] view   [← →] period   [/] search   [esc] back" />
      <div className={styles.topBar}>
        <h1 className={styles.title}>Dashboard</h1>
        <div className={styles.periodNav}>
          {range !== 'alltime' && (
            <button className={styles.navBtn} onClick={() => goPeriod(-1)}>
              ‹
            </button>
          )}
          <span className={styles.periodLabel}>{formatPeriodLabel(range, anchor)}</span>
          {range !== 'alltime' && (
            <button className={styles.navBtn} onClick={() => goPeriod(1)}>
              ›
            </button>
          )}
        </div>
        <div className={styles.rangePills}>
          {RANGES.map((r) => (
            <button key={r} className={r === range ? styles.pillActive : styles.pill} onClick={() => pickRange(r)}>
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.controls}>
        <div className={styles.tabs}>
          {views.map((v) => (
            <button key={v} className={v === view ? styles.tabActive : styles.tab} onClick={() => { setView(v); setMerchantDrill(null); }}>
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
        <button
          className={driftMode ? styles.driftBtnActive : styles.driftBtn}
          onClick={() => setDriftMode((m) => !m)}
          title="Compare against prior periods"
        >
          Δ delta
        </button>
        <div className={styles.searchWrap}>
          <input
            ref={searchRef}
            className={styles.search}
            placeholder="Search transactions…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setSearch(searchInput);
              if (e.key === 'Escape') {
                setSearch('');
                setSearchInput('');
                e.currentTarget.blur();
              }
            }}
          />
          {searchStats && searchInput && (
            <span className={`dim ${styles.searchStats}`}>
              {searchStats.count} txn{searchStats.count === 1 ? '' : 's'}
              {searchStats.expenses > 0 ? ` · ${fmt(searchStats.expenses)}` : ''}
            </span>
          )}
          {search && (
            <button
              className={styles.clearSearch}
              onClick={() => {
                setSearch('');
                setSearchInput('');
              }}
            >
              clear
            </button>
          )}
        </div>
        {selectedAccount && (
          <span className={styles.acctFilter}>
            {selectedAccount.name}
            <button onClick={() => setSelectedAccount(null)}>✕</button>
          </span>
        )}
      </div>

      {displaySummary && (
        <div className={styles.cards}>
          <div className={styles.card}>
            <div className={styles.cardLabel}>Income</div>
            <div className={`num pos ${styles.cardValue}`}>{fmt(displaySummary.income)}</div>
          </div>
          <div className={styles.card}>
            <div className={styles.cardLabel}>Expenses</div>
            <div className={`num neg ${styles.cardValue}`}>{fmt(displaySummary.expenses)}</div>
          </div>
          <div className={styles.card}>
            <div className={styles.cardLabel}>Net</div>
            <div className={`num ${displaySummary.net >= 0 ? 'pos' : 'neg'} ${styles.cardValue}`}>
              {fmtSigned(displaySummary.net)}
            </div>
          </div>
          {!search && (uncategorized ?? 0) > 0 && (
            <button
              className={`${styles.card} ${styles.cardClickable}`}
              onClick={() => drillToTransactions({ categories: ['Uncategorized'] })}
              title="Review uncategorized transactions"
            >
              <div className={styles.cardLabel}>Uncategorized</div>
              <div className={`num warn ${styles.cardValue}`}>{uncategorized} txns</div>
            </button>
          )}
        </div>
      )}

      {/* ── Main panel ── */}
      {view === 'categories' && merchantDrill && (
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <button className={styles.backBtn} onClick={() => setMerchantDrill(null)}>
              ‹ back
            </button>
            <h2>Top merchants · {merchantDrill}</h2>
          </div>
          {merchantRows && merchantRows.length === 0 ? (
            <p className="dim">No merchant spend for this category in this period.</p>
          ) : (
            <table className={styles.table}>
              <tbody>
                {(merchantRows ?? []).map((row, i) => (
                  <tr
                    key={`${row.merchant}-${i}`}
                    className={styles.rowClickable}
                    onClick={() => drillToTransactions({ categories: [merchantDrill] }, { search: row.merchant })}
                  >
                    <td className={styles.tdName}>{row.merchant}</td>
                    <td className="num warn">{fmt(row.total)}</td>
                    <td className="num dim">{row.count}x</td>
                    <td className="num dim">{Math.round(row.pct * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {view === 'categories' && !merchantDrill && (
        <section className={styles.panel}>
          <h2>Spending by category</h2>
          {driftMode && range === 'alltime' ? (
            <p className="dim">Delta not available for All Time range.</p>
          ) : driftMode ? (
            sortedDrift && sortedDrift.length === 0 ? (
              <p className="dim">No expense data for this period.</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    {driftHeader('category', 'Category')}
                    {driftHeader('current', 'Amount')}
                    {driftHeader('lastPeriodDelta', 'vs prev')}
                    {driftHeader('lastYearDelta', 'yr ago')}
                    {driftHeader('avg12mDelta', '12m avg')}
                  </tr>
                </thead>
                <tbody>
                  {(sortedDrift ?? []).map((row: CategoryDrift) => {
                    const cls = driftClass(row.current, row.avg12m);
                    return (
                      <tr
                        key={row.category}
                        className={styles.rowClickable}
                        onClick={() => drillToTransactions({ categories: [row.category] })}
                      >
                        <td className={`${styles.tdName} ${cls}`}>{row.category}</td>
                        <td className="num">{fmt(row.current)}</td>
                        <td className={`num ${cls}`}>{fmtDelta(row.lastPeriodDelta)}</td>
                        <td className={`num ${cls}`}>{fmtDelta(row.lastYearDelta)}</td>
                        <td className={`num ${cls}`}>{fmtDelta(row.avg12mDelta)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : categories.length === 0 ? (
            <p className="dim">{search ? 'No matching transactions for this period.' : 'No expense data for this period.'}</p>
          ) : (
            <table className={styles.table}>
              <tbody>
                {categories.map((row) => (
                  <tr
                    key={row.category}
                    className={styles.rowClickable}
                    onClick={() => drillToTransactions({ categories: [row.category] }, search ? { search } : {})}
                  >
                    <td className={styles.tdName}>{row.category}</td>
                    <td className="num">{fmt(row.total)}</td>
                    <td className={styles.tdBar}>
                      <Bar value={row.total} max={maxCategorySpend} />
                    </td>
                    <td className={styles.tdAction}>
                      {!search && (
                        <button
                          className={styles.merchantBtn}
                          title="Top merchants"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMerchantDrill(row.category);
                          }}
                        >
                          merchants
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {view === 'flex' && (
        <section className={styles.panel}>
          <h2>Spending by flexibility</h2>
          {driftMode && range === 'alltime' ? (
            <p className="dim">Delta not available for All Time range.</p>
          ) : driftMode && flexDrift ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Tier</th>
                  <th className={styles.th}>Amount</th>
                  <th className={styles.th}>vs prev</th>
                  <th className={styles.th}>yr ago</th>
                  <th className={styles.th}>12m avg</th>
                </tr>
              </thead>
              <tbody>
                {FLEX_TIERS.map(({ key, label, cssVar }) => {
                  const slice = flexDrift[key];
                  if (slice.current === 0 && slice.avg12m === 0) return null;
                  const cls = driftClass(slice.current, slice.avg12m);
                  return (
                    <tr key={key}>
                      <td className={styles.tdName} style={{ color: cssVar }}>
                        {label}
                      </td>
                      <td className="num">{fmt(slice.current)}</td>
                      <td className={`num ${cls}`}>{fmtDelta(slice.lastPeriodDelta)}</td>
                      <td className={`num ${cls}`}>{fmtDelta(slice.lastYearDelta)}</td>
                      <td className={`num ${cls}`}>{fmtDelta(slice.avg12mDelta)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : displayFlex ? (
            <>
              <table className={styles.table}>
                <tbody>
                  {FLEX_TIERS.map(({ key, label, cssVar }) => {
                    const amount = displayFlex[key];
                    if (amount === 0) return null;
                    const clickable = key !== 'untagged';
                    return (
                      <tr
                        key={key}
                        className={clickable ? styles.rowClickable : undefined}
                        onClick={
                          clickable
                            ? () => {
                                const flexKey = key as 'fixed' | 'flexible' | 'discretionary';
                                // drillFrom only when a filter level was actually
                                // pushed, so Esc's pop doesn't eat an unrelated level.
                                if (selectedAccount) drillToTransactions({}, { flex: flexKey });
                                else navigate('transactions', { from, to, range, anchor: from, flex: flexKey });
                              }
                            : undefined
                        }
                      >
                        <td className={styles.tdName} style={{ color: cssVar }}>
                          {label}
                        </td>
                        <td className="num">{fmt(amount)}</td>
                        <td className="num dim">{pct(amount, totalExpenses)}</td>
                        <td className={styles.tdBar}>
                          <Bar value={amount} max={totalExpenses} color={cssVar} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {displayFlex.untagged > 0 && !search && (
                <p className="dim">
                  {pct(displayFlex.untagged, totalExpenses)} untagged — set tiers in Rules → Categories
                </p>
              )}
            </>
          ) : null}
        </section>
      )}

      {view === 'account' && (
        <section className={styles.panel}>
          <h2>By account</h2>
          {(accountRows ?? []).length === 0 ? (
            <p className="dim">No accounts linked — add one in Accounts.</p>
          ) : driftMode && range === 'alltime' ? (
            <p className="dim">Delta not available for All Time range.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Account</th>
                  <th className={styles.th}>{driftMode ? 'vs prev' : 'Income'}</th>
                  <th className={styles.th}>Expenses</th>
                  <th className={styles.th}>Filter</th>
                </tr>
              </thead>
              <tbody>
                {(accountRows ?? []).map((acct) => {
                  const drift = driftMode ? acctDrift?.find((d) => d.id === acct.id) : undefined;
                  const cls = drift ? driftClass(drift.current, drift.avg12m) : '';
                  const isFiltered = selectedAccount?.id === acct.id;
                  return (
                    <tr
                      key={acct.id}
                      className={styles.rowClickable}
                      onClick={() => drillToTransactions({ accounts: [acct.id] })}
                    >
                      <td className={styles.tdName} style={isFiltered ? { color: 'var(--warning)' } : undefined}>
                        {acct.name}
                      </td>
                      {driftMode ? (
                        <td className={`num ${cls}`}>{drift ? fmtDelta(drift.lastPeriodDelta) : '—'}</td>
                      ) : (
                        <td className={`num ${acct.income > 0 ? 'pos' : 'dim'}`}>
                          {acct.income > 0 ? fmt(acct.income) : '—'}
                        </td>
                      )}
                      <td className={`num ${driftMode ? cls : acct.spending > 0 ? 'neg' : 'dim'}`}>
                        {acct.spending > 0 ? fmt(acct.spending) : '—'}
                      </td>
                      <td className={styles.tdAction}>
                        <button
                          className={isFiltered ? styles.filterBtnActive : styles.filterBtn}
                          title={isFiltered ? 'Clear dashboard account filter' : 'Scope dashboard to this account'}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAccount(isFiltered ? null : acct);
                          }}
                        >
                          {isFiltered ? '● filtered' : '○ filter'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      {view === 'owner' && (
        <section className={styles.panel}>
          <h2>Spending by owner</h2>
          <table className={styles.table}>
            <tbody>
              {(ownerRows ?? []).map((row) => (
                <tr key={row.owner}>
                  <td className={styles.tdName} style={row.owner === 'Unassigned' ? { color: 'var(--text-dim)' } : undefined}>
                    {row.owner}
                  </td>
                  <td className={`num ${row.spending > 0 ? 'neg' : 'dim'}`}>
                    {row.spending > 0 ? fmt(row.spending) : '—'}
                  </td>
                  <td className={styles.tdBar}>
                    <Bar value={row.spending} max={maxOwnerSpend} color="var(--manual)" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="dim">Assign owners in Accounts.</p>
        </section>
      )}
    </div>
  );
}
