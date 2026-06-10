// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../core/db.js', async () => {
  const { makeTestDb } = await import('../helpers/makeTestDb.js');
  return { db: await makeTestDb() };
});

vi.mock('../../core/canvas-history.js', () => ({
  loadHistory: () => [],
  deleteHistoryEntry: () => true,
  CANVAS_SPEC_PATH: '/tmp/fungible-test-nonexistent-canvas.json',
}));

import { installBridge, renderScreen } from './helpers/renderGui.js';
import { Canvas, CanvasView } from '../../gui/renderer/src/screens/Canvas.js';
import type { CanvasSpec } from '../../core/canvas-spec.js';

const SPEC: CanvasSpec = {
  title: 'Credit Card Payoff',
  elements: [
    { type: 'section', label: 'INPUTS' },
    { type: 'text', content: 'Adjust the dials to model your payoff.' },
    { type: 'dial', dial: { key: 'balance', label: 'Balance', default: 20000, step: 500, min: 0, format: 'dollar', hint: 'current balance' } },
    { type: 'dial', dial: { key: 'rate', label: 'APR', default: 22, step: 0.5, min: 0, max: 40, format: 'percent', hint: 'annual rate' } },
    { type: 'dial', dial: { key: 'monthly', label: 'Monthly payment', default: 500, step: 50, min: 0, format: 'dollar', hint: 'what you pay' } },
    { type: 'section', label: 'RESULTS' },
    { type: 'output', output: { label: 'Months to payoff', expr: '-Math.log(1 - balance * rate/100/12 / monthly) / Math.log(1 + rate/100/12)', format: 'months', color: 'neutral' } },
  ],
};

beforeEach(() => {
  installBridge();
});

afterEach(() => cleanup());

describe('GUI CanvasView', () => {
  it('renders sections, text, dials and computed outputs', () => {
    renderScreen(<CanvasView spec={SPEC} />);
    expect(screen.getByText('Credit Card Payoff')).toBeTruthy();
    expect(screen.getByText('INPUTS')).toBeTruthy();
    expect(screen.getByText(/Adjust the dials/)).toBeTruthy();
    expect(screen.getByText('Balance')).toBeTruthy();
    expect(screen.getByText('$20,000.00')).toBeTruthy();
    expect(screen.getByText('Months to payoff')).toBeTruthy();
    // 20000 @ 22% APR with $500/mo → 72.8 months
    expect(screen.getByText('72.8 mo')).toBeTruthy();
  });

  it('stepping a dial recomputes outputs and offers reset', async () => {
    renderScreen(<CanvasView spec={SPEC} />);
    const monthlyDial = screen.getByText('Monthly payment').closest('div')!.parentElement!;
    const plus = Array.from(monthlyDial.querySelectorAll('button')).find((b) => b.textContent === '+')!;
    await userEvent.click(plus);
    expect(screen.getByText('$550.00')).toBeTruthy();
    expect(screen.queryByText('72.8 mo')).toBeNull(); // recomputed
    await userEvent.click(screen.getByText('reset'));
    expect(screen.getByText('$500.00')).toBeTruthy();
    expect(screen.getByText('72.8 mo')).toBeTruthy();
  });

  it('bounded dials render sliders and respect max', async () => {
    renderScreen(<CanvasView spec={SPEC} />);
    const aprDial = screen.getByText('APR').closest('div')!.parentElement!;
    const slider = aprDial.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider).toBeTruthy();
    expect(slider.max).toBe('40');
  });
});

describe('GUI Canvas screen', () => {
  it('shows the empty state and history panel', async () => {
    renderScreen(<Canvas />);
    await waitFor(() => expect(screen.getByText(/No canvas yet/)).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: /history \(0\)/ }));
    await waitFor(() => expect(screen.getByText('No canvases found.')).toBeTruthy());
  });

  it('loads a spec from the canvasSpec nav payload', async () => {
    renderScreen(<Canvas />, { txFilter: { canvasSpec: JSON.stringify(SPEC) } });
    await waitFor(() => expect(screen.getByText('Credit Card Payoff')).toBeTruthy());
    expect(screen.getByText('Months to payoff')).toBeTruthy();
  });
});
