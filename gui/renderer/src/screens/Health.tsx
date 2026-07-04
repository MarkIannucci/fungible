import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useQuery } from '../hooks/useQuery.js';
import { useNav } from '../hooks/useNav.js';
import { fmt, fmtSigned, fmtPct, fmtMonths, fmtCompact } from '../../../../core/fmt.js';
import { getDriftWindows, getPeriodStart } from '../../../../core/dateUtils.js';
import { bucketDrift } from '../../../../core/scorecard.js';
import { KeyHints } from '../components/KeyHints.js';
import styles from './Health.module.css';

const DEFAULT_WITHDRAWAL = 4.0;
const DEFAULT_GROWTH = 7.0;
const SPEND_STEP = 100;

function savingsRateClass(rate: number): string {
  if (rate < 0) return 'neg';
  if (rate < 10) return 'warn';
  if (rate < 20) return '';
  return 'pos';
}

function runwayClass(months: number, green: number, yellow: number): string {
  if (months >= green) return 'pos';
  if (months >= yellow) return 'warn';
  return 'neg';
}

function roundToStep(n: number): number {
  return Math.round(n / SPEND_STEP) * SPEND_STEP;
}

export function Health() {
  const { navigate } = useNav();
  const data = useQuery(() => api.health.loadHealthData(), []);

  // Trailing-30-day scorecard: which categories drifted from typical recently.
  const drift = useQuery(() => {
    const today = new Date();
    const w = getDriftWindows('last30', getPeriodStart('last30', today), today);
    return w
      ? api.queries.getCategoryDriftData(w.current, w.lastPeriod, w.lastYear, w.rolling12)
      : Promise.resolve(null);
  }, []);
  const scorecard = useMemo(() => (drift ? bucketDrift(drift) : null), [drift]);
  const topUnder = useMemo(
    () => (scorecard ? [...scorecard.under].sort((a, b) => a.medianDelta - b.medianDelta).slice(0, 2) : []),
    [scorecard],
  );

  const [monthlySpend, setMonthlySpend] = useState<number | null>(null);
  const [monthlySavings, setMonthlySavings] = useState<number | null>(null);
  const [withdrawal, setWithdrawal] = useState(DEFAULT_WITHDRAWAL);
  const [growth, setGrowth] = useState(DEFAULT_GROWTH);

  const defaultSpend = data ? Math.max(SPEND_STEP, roundToStep(data.avgMonthlyExpenses)) : SPEND_STEP;
  const defaultSavings = data ? roundToStep(data.monthlySavings) : 0;
  const spend = monthlySpend ?? defaultSpend;
  const savings = monthlySavings ?? defaultSavings;

  const annualSpend = spend * 12;
  const fireNumber = annualSpend / (withdrawal / 100);

  const [years, setYears] = useState<number | null>(null);
  const [coast, setCoast] = useState<number | null>(null);
  useEffect(() => {
    if (!data) return;
    void api.health.yearsToFire(data.netWorth, savings, fireNumber, growth).then(setYears);
    void api.health.coastYears(data.netWorth, fireNumber, growth).then(setCoast);
  }, [data, savings, fireNumber, growth]);

  if (!data) return <p className="dim">Loading…</p>;

  const cashMonths = spend > 0 ? data.cash / spend : 0;
  const liquidMonths = spend > 0 ? data.liquid / spend : 0;
  const fireProgress = fireNumber > 0 ? Math.max(0, data.netWorth) / fireNumber : 0;
  const savingsRate = data.monthlyIncome > 0 ? (savings / data.monthlyIncome) * 100 : null;
  const netCash = data.cash - data.totalDebt;
  const remainingDebt = Math.max(0, data.totalDebt - data.cash);
  const debtMonths = savings > 0 ? remainingDebt / savings : null;

  return (
    <div className={styles.screen}>
      <KeyHints hints="[1-9·0] screens" />
      <h1 className={styles.title}>Financial Health</h1>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <h2>Snapshot</h2>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>Savings rate</span>
            {savingsRate === null ? (
              <span className="dim">—</span>
            ) : (
              <span className={`num ${savingsRateClass(savingsRate)} ${styles.metricValue}`}>{fmtPct(savingsRate)}</span>
            )}
            <span className={`dim ${styles.metricHint}`}>
              {savingsRate === null
                ? 'no income found in transactions'
                : savingsRate < 0
                  ? 'spending more than earning'
                  : savingsRate < 10
                    ? 'aim for 20%+'
                    : savingsRate < 20
                      ? 'getting there — aim for 20%+'
                      : savingsRate >= 50
                        ? 'FIRE pace'
                        : 'on track'}
            </span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>Monthly income</span>
            <span className={`num ${styles.metricValue}`}>{fmt(data.monthlyIncome)}</span>
            <span className={`dim ${styles.metricHint}`}>avg past 12 months</span>
          </div>
        </section>

        <section className={styles.panel}>
          <h2>Runway</h2>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>Cash</span>
            <span className={`num ${runwayClass(cashMonths, 6, 3)} ${styles.metricValue}`}>{fmtMonths(cashMonths)}</span>
            <span className={`dim ${styles.metricHint}`}>{fmt(data.cash)} in checking/savings</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>Liquid</span>
            <span className={`num ${runwayClass(liquidMonths, 12, 6)} ${styles.metricValue}`}>{fmtMonths(liquidMonths)}</span>
            <span className={`dim ${styles.metricHint}`}>{fmt(data.liquid)} incl. brokerage</span>
          </div>
        </section>

        {scorecard && (scorecard.over.length > 0 || scorecard.under.length > 0) && (
          <section className={styles.panel}>
            <h2>Last 30 days · vs typical</h2>
            {scorecard.over.length > 0 && (
              <div className={styles.metric}>
                <span className={styles.metricLabel}>Watch</span>
                <span className={`neg ${styles.metricValue}`}>
                  {scorecard.over.slice(0, 2).map((r) => `${r.category} ${fmtSigned(r.medianDelta, 0)}`).join('  ·  ')}
                </span>
              </div>
            )}
            {topUnder.length > 0 && (
              <div className={styles.metric}>
                <span className={styles.metricLabel}>Good</span>
                <span className={`pos ${styles.metricValue}`}>
                  {topUnder.map((r) => `${r.category} ${fmtSigned(r.medianDelta, 0)}`).join('  ·  ')}
                </span>
              </div>
            )}
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Net</span>
              <span className={`num ${scorecard.net <= 0 ? 'pos' : 'warn'} ${styles.metricValue}`}>
                {fmtSigned(scorecard.net, 0)}
              </span>
              <button
                className={`dim ${styles.scorecardLink}`}
                onClick={() => navigate('dashboard', { range: 'last30', scorecard: true })}
              >
                full scorecard →
              </button>
            </div>
          </section>
        )}

        {data.totalDebt > 0 && (
          <section className={styles.panel}>
            <h2>Debt</h2>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Net cash</span>
              <span className={`num ${netCash >= 0 ? 'pos' : 'neg'} ${styles.metricValue}`}>{fmtSigned(netCash)}</span>
              <span className={`dim ${styles.metricHint}`}>
                {netCash >= 0 ? 'could pay off now' : `${fmtCompact(data.cash)} cash · ${fmtCompact(data.totalDebt)} debt`}
              </span>
            </div>
            {netCash < 0 && (
              <div className={styles.metric}>
                <span className={styles.metricLabel}>Debt-free in</span>
                {debtMonths === null ? (
                  <span className={`neg ${styles.metricValue}`}>no surplus</span>
                ) : (
                  <span className={`num ${debtMonths <= 6 ? 'pos' : debtMonths <= 24 ? 'warn' : ''} ${styles.metricValue}`}>
                    {fmtMonths(debtMonths)}
                  </span>
                )}
                <span className={`dim ${styles.metricHint}`}>
                  {debtMonths !== null ? `${fmtCompact(remainingDebt)} remaining after cash` : 'increase savings to pay off debt'}
                </span>
              </div>
            )}
          </section>
        )}

        <section className={`${styles.panel} ${styles.panelWide}`}>
          <h2>Retirement</h2>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>Net worth</span>
            <span className={`num ${data.netWorth >= 0 ? 'pos' : 'neg'} ${styles.metricValue}`}>{fmtCompact(data.netWorth)}</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>FIRE number</span>
            <span className={`num ${styles.metricValue}`}>{fmtCompact(fireNumber)}</span>
            <span className={styles.fireProgress}>
              <span className={styles.progressTrack}>
                <span className={styles.progressFill} style={{ width: `${Math.min(100, fireProgress * 100)}%` }} />
              </span>
              <span className="dim">{fmtPct(fireProgress * 100)}</span>
            </span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>Coast FIRE</span>
            {coast === null ? (
              <span className={`dim ${styles.metricValue}`}>—</span>
            ) : coast === 0 ? (
              <span className={`pos ${styles.metricValue}`}>Achieved!</span>
            ) : (
              <span className={`accent num ${styles.metricValue}`}>~{Math.ceil(coast)} yr</span>
            )}
            <span className={`dim ${styles.metricHint}`}>
              {coast === null ? 'need positive net worth' : coast === 0 ? 'growth alone covers retirement' : 'if you stop saving now'}
            </span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>Est. years away</span>
            {years === null ? (
              <span className={`warn ${styles.metricValue}`}>100+ years</span>
            ) : years === 0 ? (
              <span className={`pos ${styles.metricValue}`}>Achieved!</span>
            ) : (
              <span className={`accent num ${styles.metricValue}`}>~{Math.ceil(years)} yr</span>
            )}
          </div>
        </section>
      </div>

      <section className={styles.panel}>
        <h2>Assumptions</h2>
        <div className={styles.dials}>
          <DollarDial
            label="Monthly spending"
            value={spend}
            defaultValue={defaultSpend}
            min={SPEND_STEP}
            hint="avg past 12 months"
            onChange={(v) => setMonthlySpend(Math.max(SPEND_STEP, v))}
            onReset={() => setMonthlySpend(null)}
          />
          <DollarDial
            label="Monthly savings"
            value={savings}
            defaultValue={defaultSavings}
            hint="avg surplus past 12 mo"
            signed
            onChange={setMonthlySavings}
            onReset={() => setMonthlySavings(null)}
          />
          <SliderDial
            label="Withdrawal rate"
            value={withdrawal}
            defaultValue={DEFAULT_WITHDRAWAL}
            min={0.5}
            max={10}
            step={0.5}
            hint="safe withdrawal rate"
            onChange={setWithdrawal}
          />
          <SliderDial
            label="Growth rate"
            value={growth}
            defaultValue={DEFAULT_GROWTH}
            min={0}
            max={20}
            step={0.5}
            hint="real annual return"
            onChange={setGrowth}
          />
        </div>
      </section>
    </div>
  );
}

function DollarDial({
  label,
  value,
  defaultValue,
  min,
  hint,
  signed,
  onChange,
  onReset,
}: {
  label: string;
  value: number;
  defaultValue: number;
  min?: number;
  hint: string;
  signed?: boolean;
  onChange: (v: number) => void;
  onReset: () => void;
}) {
  const changed = value !== defaultValue;
  return (
    <div className={styles.dial}>
      <div className={styles.dialHeader}>
        <span className={styles.dialLabel}>{label}</span>
        <span className={`num ${signed && value < 0 ? 'neg' : ''} ${styles.dialValue}`}>
          {signed ? fmtSigned(value, 0) : fmt(value, 0)}
        </span>
      </div>
      <div className={styles.dialControls}>
        <button className={styles.stepBtn} onClick={() => onChange(value - SPEND_STEP)}>
          −
        </button>
        <input
          type="number"
          className={styles.dialInput}
          value={value}
          step={SPEND_STEP}
          min={min}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            if (!isNaN(n)) onChange(roundToStep(n));
          }}
        />
        <button className={styles.stepBtn} onClick={() => onChange(value + SPEND_STEP)}>
          +
        </button>
        {changed && (
          <button className={styles.resetBtn} onClick={onReset} title={`Reset to ${fmt(defaultValue, 0)}`}>
            reset
          </button>
        )}
      </div>
      <span className={`dim ${styles.dialHint}`}>
        {hint}
        {changed ? ' (modified)' : ''}
      </span>
    </div>
  );
}

function SliderDial({
  label,
  value,
  defaultValue,
  min,
  max,
  step,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  hint: string;
  onChange: (v: number) => void;
}) {
  const changed = value !== defaultValue;
  return (
    <div className={styles.dial}>
      <div className={styles.dialHeader}>
        <span className={styles.dialLabel}>{label}</span>
        <span className={`num ${styles.dialValue}`}>{fmtPct(value)}</span>
      </div>
      <div className={styles.dialControls}>
        <input
          type="range"
          className={styles.slider}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        {changed && (
          <button className={styles.resetBtn} onClick={() => onChange(defaultValue)} title={`Reset to ${fmtPct(defaultValue)}`}>
            reset
          </button>
        )}
      </div>
      <span className={`dim ${styles.dialHint}`}>
        {hint}
        {changed ? ' (modified)' : ''}
      </span>
    </div>
  );
}
