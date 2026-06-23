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
import { Rules } from '../../gui/renderer/src/screens/Rules.js';

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

describe('GUI Rules', () => {
  it('lists the seeded category rule', async () => {
    renderScreen(<Rules />);
    await waitFor(() => expect(screen.getByText('Whole Foods')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Category rules (1)' })).toBeTruthy();
    expect(screen.getByText('Grocery')).toBeTruthy();
  });

  it('creates a category rule with live match count and recategorizes', async () => {
    renderScreen(<Rules />);
    await waitFor(() => expect(screen.getByText('Whole Foods')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: '+ Add' }));
    await userEvent.type(screen.getByPlaceholderText('e.g. UBER or ^AMZN'), 'Trader');
    await waitFor(() => expect(screen.getByText('1 transactions match')).toBeTruthy());
    const selects = screen.getAllByRole('combobox');
    await userEvent.selectOptions(selects[1], 'Dining'); // [0] = match type, [1] = category
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText(/recategorized \d+ transactions?/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Category rules (2)' })).toBeTruthy();
  });

  it('deletes a rule', async () => {
    renderScreen(<Rules />);
    await waitFor(() => expect(screen.getByText('Whole Foods')).toBeTruthy());
    const row = screen.getByText('Whole Foods').closest('tr')!;
    await userEvent.click(Array.from(row.querySelectorAll('button')).find((b) => b.textContent === 'delete')!);
    await waitFor(() => expect(screen.getByText(/Rule deleted · recategorized \d+ transactions?/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Category rules (0)' })).toBeTruthy();
  });

  it('creates a name rule', async () => {
    renderScreen(<Rules />);
    await waitFor(() => expect(screen.getByText('Whole Foods')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Name rules (0)' }));
    await waitFor(() => expect(screen.getByText('No name rules yet.')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: '+ Add' }));
    await userEvent.type(screen.getByPlaceholderText('e.g. AMZN Mktp'), 'AMZN');
    await userEvent.type(screen.getByPlaceholderText('e.g. Amazon'), 'Amazon');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('Name rule saved')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Name rules (1)' })).toBeTruthy();
  });

  it('categories tab lists categories with flexibility and visibility controls', async () => {
    renderScreen(<Rules />);
    await waitFor(() => expect(screen.getByText('Whole Foods')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Categories (5)' }));
    await waitFor(() => expect(screen.getByText('Grocery')).toBeTruthy());
    expect(screen.getByText('Dining')).toBeTruthy();
    // Grocery's inline flexibility select shows 'flexible'
    const grocerySelect = screen.getByText('Grocery').closest('tr')!.querySelector('select') as HTMLSelectElement;
    expect(grocerySelect.value).toBe('flexible');
    // toggle visibility
    const visibleBtn = Array.from(screen.getByText('Grocery').closest('tr')!.querySelectorAll('button'))
      .find((b) => b.textContent === 'visible')!;
    await userEvent.click(visibleBtn);
    await waitFor(() => {
      const row = screen.getByText('Grocery').closest('tr')!;
      expect(Array.from(row.querySelectorAll('button')).some((b) => b.textContent === 'hidden')).toBe(true);
    });
  });

  it('changes a category flexibility inline', async () => {
    renderScreen(<Rules />);
    await waitFor(() => expect(screen.getByText('Whole Foods')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Categories (5)' }));
    await waitFor(() => expect(screen.getByText('Shopping')).toBeTruthy());
    const select = screen.getByText('Shopping').closest('tr')!.querySelector('select') as HTMLSelectElement;
    await userEvent.selectOptions(select, 'fixed');
    await waitFor(() => {
      const after = screen.getByText('Shopping').closest('tr')!.querySelector('select') as HTMLSelectElement;
      expect(after.value).toBe('fixed');
    });
  });

  it('shows uncategorized count when present', async () => {
    await db.execute(
      `INSERT INTO transactions (id, account_id, date, name, amount, category, pending, ignored)
       VALUES ('tx-unc', 'test-credit', '2026-05-20', 'Mystery Shop', 10.00, 'Uncategorized', 0, 0)`,
    );
    renderScreen(<Rules />);
    await waitFor(() => expect(screen.getByText('1 uncategorized')).toBeTruthy());
  });
});
