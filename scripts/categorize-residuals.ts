/**
 * Adds rules for residual uncategorized transactions and applies them.
 * Safe to re-run — uses INSERT OR IGNORE on patterns.
 */
import 'dotenv/config';
import { initDb, db } from '../core/db.js';
import { categorize } from '../core/categorize.js';

initDb();

const rules: { priority: number; match_type: 'name' | 'regex'; pattern: string; category: string }[] = [
  // ── European POS systems (Zettle = PayPal's Square, SumUp, WEIQ) ──────────
  { priority: 9, match_type: 'regex', pattern: '^Zettle_\\*', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: '^ZETTLE_\\*', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: '^SumUp\\s*\\*', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: '^WEIQ\\s', category: 'Food & Drink' },

  // ── Food chains / cafes ───────────────────────────────────────────────────
  { priority: 9, match_type: 'regex', pattern: 'IKEA.*REST', category: 'Food & Drink' },
  { priority: 9, match_type: 'name',  pattern: '85C BAKERY', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'KRISPY KREME', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'PROTEIN BAR', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'MOONLITE BARBQ', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'CHEESE BOARD', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'Meadowlark Dairy', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'HMS Host', category: 'Food & Drink' },  // airport restaurants
  { priority: 9, match_type: 'regex', pattern: 'LEVY@', category: 'Food & Drink' },     // Levy stadium/venue food
  { priority: 9, match_type: 'regex', pattern: '365 MARKET', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'Bxl Food', category: 'Food & Drink' },
  { priority: 9, match_type: 'name',  pattern: 'Swig', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'SKYLINE.*NICHOLA', category: 'Food & Drink' }, // Skyline Chili

  // ── Canadian food (Montreal) ──────────────────────────────────────────────
  { priority: 9, match_type: 'regex', pattern: 'ST-VIATEUR BAGEL', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'LA BANQUISE', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'OLIVE & GOURMANDO', category: 'Food & Drink' },

  // ── Debit card purchases at food places (Capital One format) ─────────────
  { priority: 8, match_type: 'regex', pattern: 'Debit Card Purchase.*FOOD', category: 'Food & Drink' },
  { priority: 8, match_type: 'regex', pattern: 'Debit Card Purchase.*BAKERI', category: 'Food & Drink' },
  { priority: 8, match_type: 'regex', pattern: 'Debit Card Purchase.*KAFE', category: 'Food & Drink' },
  { priority: 8, match_type: 'regex', pattern: 'Debit Card Purchase.*SHELL', category: 'Transportation' },

  // ── Personal Care ─────────────────────────────────────────────────────────
  { priority: 9, match_type: 'regex', pattern: 'MASSAGE CENTER', category: 'Personal Care' },

  // ── Bills & Utilities ─────────────────────────────────────────────────────
  { priority: 9, match_type: 'regex', pattern: 'GOOGLE.*Google One', category: 'Bills & Utilities' },

  // ── Transfers / Refunds ───────────────────────────────────────────────────
  { priority: 10, match_type: 'regex', pattern: 'CASH BACK', category: 'Income' },
  { priority: 10, match_type: 'regex', pattern: 'Refund Globalblue', category: 'Transfer' },   // EU VAT refunds
  { priority: 10, match_type: 'regex', pattern: 'support@keeperta', category: 'Transfer' },    // Keeper savings
  { priority: 10, match_type: 'regex', pattern: 'GUSTO ACCTVERIFY', category: 'Transfer' },

  // ── Taxes / Government ────────────────────────────────────────────────────
  // Note: FRANCHISE TAX BD.*TAXRFD is already Income (refund); bare FRANCHISE TAX BD is a payment
  { priority: 9, match_type: 'name',  pattern: 'FRANCHISE TAX BD', category: 'Taxes' },
  { priority: 9, match_type: 'regex', pattern: 'OV PTA', category: 'Government' }, // school PTA

  // ── Travel (hotels, B&Bs) ─────────────────────────────────────────────────
  { priority: 9, match_type: 'regex', pattern: 'BLUE DOOR INNS', category: 'Travel' },
  { priority: 9, match_type: 'regex', pattern: '^BCK\\*', category: 'Travel' },        // Booking.com

  // ── Transportation ────────────────────────────────────────────────────────
  { priority: 9, match_type: 'regex', pattern: 'Debit Card Purchase.*GAS', category: 'Transportation' },
  { priority: 9, match_type: 'regex', pattern: 'GASOLINE', category: 'Transportation' },
  { priority: 9, match_type: 'regex', pattern: '^AGENT FEE\\s', category: 'Bills & Utilities' }, // international SIM/phone

  // ── Shopping ──────────────────────────────────────────────────────────────
  { priority: 9, match_type: 'regex', pattern: 'WHSMITH', category: 'Shopping' },
  { priority: 9, match_type: 'regex', pattern: 'CRAIGSLIST', category: 'Services' },
  { priority: 9, match_type: 'regex', pattern: 'Debit Card Purchase.*NETTO', category: 'Food & Drink' }, // Netto grocery

  // ── Professional / Education ──────────────────────────────────────────────
  { priority: 9, match_type: 'regex', pattern: 'CFA Institute', category: 'Services' },

  // ── Food — specific chains & one-off international spots ──────────────────
  { priority: 9, match_type: 'regex', pattern: 'CAFE RIO', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'CAFE ZUPAS', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'CACTUS TACO', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: "AMYS DRIVE THRU", category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'ARMK', category: 'Food & Drink' },     // Aramark (arena/venue)
  { priority: 9, match_type: 'regex', pattern: 'Eataly', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'McDonalds|Mc Donalds', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'DELI DEL TORO', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'MASTER KEBAB', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'AMS Cheese', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'VILLAGE BAKER', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'JULIES KITCHEN', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'MARKET STREET GRILL', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'Winkel43', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'Konditor bager', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'LAGKAGEHUSET', category: 'Food & Drink' },  // Danish bakery
  { priority: 9, match_type: 'regex', pattern: 'EMMERYS', category: 'Food & Drink' },        // Danish bakery
  { priority: 9, match_type: 'regex', pattern: 'BAKER BRUN', category: 'Food & Drink' },     // Danish bakery
  { priority: 9, match_type: 'regex', pattern: 'JOE.*JUICE', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'Deliway Rail', category: 'Food & Drink' },   // train station food
  { priority: 9, match_type: 'regex', pattern: 'Debit Card Purchase.*RESTAURANT', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'Debit Card Purchase.*CAFE', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'Debit Card Purchase.*WAFFLE', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'Debit Card Purchase.*KEBAB', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'Debit Card Purchase.*GRILL', category: 'Food & Drink' },
  { priority: 9, match_type: 'regex', pattern: 'Debit Card Purchase.*BAKERY', category: 'Food & Drink' },
  // Broad catch for clearly-food names in international transactions
  { priority: 8, match_type: 'regex', pattern: '\\bBROD\\b|\\bBRED\\b|\\bBAEKERI\\b|\\bBAGERI\\b', category: 'Food & Drink' }, // Scandinavian "bread/bakery"
  { priority: 8, match_type: 'regex', pattern: 'GATEAU', category: 'Food & Drink' },
  { priority: 8, match_type: 'regex', pattern: 'BBROOD', category: 'Food & Drink' },    // Dutch "bread"
];

const insert = db.prepare(`
  INSERT OR IGNORE INTO category_rules (priority, match_type, pattern, category)
  VALUES (?, ?, ?, ?)
`);

let added = 0;
for (const r of rules) {
  const result = insert.run(r.priority, r.match_type, r.pattern, r.category);
  if (result.changes) added++;
}
console.log(`Added ${added} new rules.`);

// Apply to all uncategorized transactions
const uncategorized = db.prepare(`
  SELECT id, name, merchant_name FROM transactions WHERE category = 'Uncategorized'
`).all() as { id: string; name: string; merchant_name: string | null }[];

const update = db.prepare(`UPDATE transactions SET category = ? WHERE id = ?`);
let changed = 0;
for (const tx of uncategorized) {
  const cat = categorize(tx.name, tx.merchant_name, null);
  if (cat !== 'Uncategorized') {
    update.run(cat, tx.id);
    changed++;
  }
}
console.log(`Recategorized ${changed} of ${uncategorized.length} transactions.`);

// Show what's still uncategorized
const remaining = db.prepare(`
  SELECT name, COUNT(*) as count
  FROM transactions WHERE category = 'Uncategorized'
  GROUP BY name ORDER BY count DESC
`).all() as { name: string; count: number }[];

if (remaining.length === 0) {
  console.log('\nAll transactions categorized!');
} else {
  console.log(`\n${remaining.length} names still uncategorized:`);
  remaining.forEach((r) => console.log(`  ${String(r.count).padStart(3)}x  ${r.name}`));
}
