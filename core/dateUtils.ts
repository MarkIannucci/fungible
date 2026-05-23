export type Range = 'week' | 'month' | 'quarter' | 'year' | 'alltime';
export const RANGES: Range[] = ['week', 'month', 'quarter', 'year', 'alltime'];
export const RANGE_LABELS: Record<Range, string> = {
  week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year', alltime: 'All Time',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n: number) { return String(n).padStart(2, '0'); }
function toStr(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

export function getPeriodStart(range: Range, d: Date): Date {
  switch (range) {
    case 'week': {
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
      monday.setHours(0, 0, 0, 0);
      return monday;
    }
    case 'month':   return new Date(d.getFullYear(), d.getMonth(), 1);
    case 'quarter': return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
    case 'year':    return new Date(d.getFullYear(), 0, 1);
    case 'alltime': return new Date(2000, 0, 1);
  }
}

export function getPeriodDates(range: Range, anchor: Date): { from: string; to: string } {
  if (range === 'alltime') return { from: '2000-01-01', to: '2099-12-31' };
  const from = toStr(anchor);
  let end: Date;
  switch (range) {
    case 'week':    end = new Date(anchor); end.setDate(anchor.getDate() + 6); break;
    case 'month':   end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0); break;
    case 'quarter': end = new Date(anchor.getFullYear(), anchor.getMonth() + 3, 0); break;
    case 'year':    end = new Date(anchor.getFullYear(), 11, 31); break;
  }
  return { from, to: toStr(end) };
}

export function navigatePeriod(range: Range, anchor: Date, delta: -1 | 1): Date {
  const d = new Date(anchor);
  switch (range) {
    case 'week':    d.setDate(d.getDate() + delta * 7); break;
    case 'month':   d.setMonth(d.getMonth() + delta); break;
    case 'quarter': d.setMonth(d.getMonth() + delta * 3); break;
    case 'year':    d.setFullYear(d.getFullYear() + delta); break;
    case 'alltime': break;
  }
  return d;
}

export function formatPeriodLabel(range: Range, anchor: Date): string {
  switch (range) {
    case 'week': {
      const end = new Date(anchor); end.setDate(anchor.getDate() + 6);
      const sameYear = anchor.getFullYear() === end.getFullYear();
      const sameMonth = anchor.getMonth() === end.getMonth();
      if (sameMonth) return `${MONTHS[anchor.getMonth()]} ${anchor.getDate()}–${end.getDate()}, ${anchor.getFullYear()}`;
      if (sameYear)  return `${MONTHS[anchor.getMonth()]} ${anchor.getDate()} – ${MONTHS[end.getMonth()]} ${end.getDate()}, ${anchor.getFullYear()}`;
      return `${MONTHS[anchor.getMonth()]} ${anchor.getDate()} – ${MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
    }
    case 'month':   return `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;
    case 'quarter': return `Q${Math.floor(anchor.getMonth() / 3) + 1} ${anchor.getFullYear()}`;
    case 'year':    return `${anchor.getFullYear()}`;
    case 'alltime': return 'All Time';
  }
}
