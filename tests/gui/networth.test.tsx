// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../core/db.js', async () => {
  const { makeTestDb } = await import('../helpers/makeTestDb.js');
  return { db: await makeTestDb() };
});

import { db } from '../../core/db.js';
import { seedTuiData } from '../helpers/seedTuiData.js';
import { installBridge, renderScreen } from './helpers/renderGui.js';
import { NetWorth } from '../../gui/renderer/src/screens/NetWorth.js';

beforeEach(async () => {
  for (const tbl of ['transactions', 'accounts', 'categories', 'tags', 'transaction_tags',
                     'category_rules', 'name_rules', 'hidden_categories', 'balance_history',
                     'household_members']) {
    await db.execute(`DELETE FROM ${tbl}`);
  }
  await seedTuiData(db);
  installBridge();
});

afterEach(() => cleanup());

describe('GUI NetWorth', () => {
  it('lists assets and liabilities with balances', async () => {
    renderScreen(<NetWorth />);
    await waitFor(() => expect(screen.getByText('Test Checking')).toBeTruthy());
    expect(screen.getAllByText('$5,000.00').length).toBeGreaterThan(0); // asset row + total
    expect(screen.getByText('Test Visa')).toBeTruthy();
    expect(screen.getByText('Total assets')).toBeTruthy();
    expect(screen.getByText('Total debt')).toBeTruthy();
  });

  it('shows a signed big net worth number', async () => {
    renderScreen(<NetWorth />);
    await waitFor(() => expect(screen.getByText('Test Checking')).toBeTruthy());
    // sign prefix on the big number span proves fmtSigned path (balance rows are <td>)
    expect(screen.getByText(/^[+-]\$[\d,]+\.\d{2}$/, { selector: 'span' })).toBeTruthy();
  });

  it('group-by-type toggle switches to subtype rollups', async () => {
    renderScreen(<NetWorth />);
    await waitFor(() => expect(screen.getByText('Test Checking')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'group by type' }));
    await waitFor(() => expect(screen.getByText('checking')).toBeTruthy());
    expect(screen.queryByText('Test Checking')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'show accounts' }));
    await waitFor(() => expect(screen.getByText('Test Checking')).toBeTruthy());
  });

  it('shows history range pills when history exists', async () => {
    renderScreen(<NetWorth />);
    await waitFor(() => expect(screen.getByText('History')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Month' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Year' })).toBeTruthy();
  });

  it('empty state without balance data', async () => {
    await db.execute('DELETE FROM balance_history');
    renderScreen(<NetWorth />);
    await waitFor(() => expect(screen.getByText(/No balance data yet/)).toBeTruthy());
  });
});
