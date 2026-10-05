import fs from 'fs';
import type { Page } from '@playwright/test';
import { test, expect, open, isoDay } from './fixtures';

// Getting data in (CSV import) and out (CSV export, full backup) and restoring it.

// What banks actually send: an Excel byte order mark, a quoted memo with a comma and a
// line break, accounting-style negatives, and two identical coffees on the same day.
const BANK_CSV =
  '﻿Date,Description,Amount,Memo\r\n' +
  '01/15/2025,Corner Coffee,(4.50),\r\n' +
  '01/15/2025,Corner Coffee,(4.50),\r\n' +
  '01/16/2025,"Acme, Inc. Payroll",2500.00,"Direct deposit\r\nJanuary"\r\n' +
  '01/17/2025,Hardware Store,-89.99,\r\n';

// A German bank's export: semicolons, day-first dates, decimal commas, and Windows-1252
// rather than UTF-8 (so the umlauts are single bytes).
const GERMAN_CSV =
  'Buchungstag;Auftraggeber / Empfänger;Verwendungszweck;Betrag\r\n' +
  '15.01.2025;Bäckerei Müller;Brötchen;-4,50\r\n' +
  '16.01.2025;"Arbeitgeber GmbH";Gehalt Januar;2.500,00\r\n' +
  '17.01.2025;Baumarkt;;-1.089,99\r\n';

async function importCsv(page: Page, csv: string, encoding: BufferEncoding = 'utf8') {
  await page.getByRole('button', { name: 'Import CSV' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import Transactions' });
  await dialog.getByLabel('CSV file').setInputFiles({
    name: 'bank-export.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, encoding),
  });
  return dialog;
}

test.describe('CSV import', () => {
  test('maps columns and imports every row, even tricky ones', async ({ page, api }) => {
    const checking = await api.createAccount('Checking', 0);
    await open(page, `/accounts/${checking.id}`);
    const dialog = await importCsv(page, BANK_CSV);

    await expect(dialog).toContainText('Found 4 rows');
    // Columns are recognized from their headers, the BOM notwithstanding
    await expect(dialog.getByRole('combobox', { name: 'Column Date' })).toHaveValue('date');
    await expect(dialog.getByRole('combobox', { name: 'Column Description' })).toHaveValue('payee');
    await expect(dialog.getByRole('combobox', { name: 'Column Amount' })).toHaveValue('amount');
    await expect(dialog.getByRole('combobox', { name: 'Column Memo' })).toHaveValue('notes');

    await dialog.getByRole('button', { name: 'Preview' }).click();
    await expect(dialog).toContainText('4 transactions found. 0 duplicates detected.');
    await dialog.getByRole('button', { name: 'Import 4 Transactions' }).click();
    await expect(dialog).toContainText('4 imported, 0 skipped');
    await dialog.getByRole('button', { name: 'Done' }).click();

    const txs = await api.transactions(`?account_id=${checking.id}&from=2025-01-01`);
    const summary = txs
      .map((t) => [t.date, t.payeeName, t.amount, t.notes])
      .sort((a, b) => String(a).localeCompare(String(b)));
    expect(summary).toEqual([
      ['2025-01-15', 'Corner Coffee', -450, null],
      ['2025-01-15', 'Corner Coffee', -450, null],
      ['2025-01-16', 'Acme, Inc. Payroll', 250_000, 'Direct deposit\r\nJanuary'],
      ['2025-01-17', 'Hardware Store', -8_999, null],
    ]);
    expect(await api.balance(checking.id)).toBe(240_101);
  });

  test('importing the same file again finds only duplicates', async ({ page, api }) => {
    const checking = await api.createAccount('Checking', 0);
    await open(page, `/accounts/${checking.id}`);
    let dialog = await importCsv(page, BANK_CSV);
    await dialog.getByRole('button', { name: 'Preview' }).click();
    await dialog.getByRole('button', { name: 'Import 4 Transactions' }).click();
    await dialog.getByRole('button', { name: 'Done' }).click();

    // The next month's export overlaps: one new row
    dialog = await importCsv(page, BANK_CSV + '01/20/2025,Bakery,(7.25),\r\n');
    await dialog.getByRole('button', { name: 'Preview' }).click();
    await expect(dialog).toContainText(
      '5 transactions found. 4 duplicates detected. 1 will be imported.',
    );
    await dialog.getByRole('button', { name: 'Import 1 Transactions' }).click();
    await expect(dialog).toContainText('1 imported, 0 skipped');
    expect(await api.transactions(`?account_id=${checking.id}&from=2025-01-01`)).toHaveLength(5);
  });

  test('reads European exports: semicolons, day-first dates and decimal commas', async ({
    page,
    api,
  }) => {
    const checking = await api.createAccount('Girokonto', 0);
    await open(page, `/accounts/${checking.id}`);
    const dialog = await importCsv(page, GERMAN_CSV, 'latin1');

    await expect(dialog).toContainText('Found 3 rows');
    await expect(dialog.getByRole('combobox', { name: 'Separator' })).toHaveValue(';');
    await expect(dialog.getByRole('combobox', { name: 'Dates' })).toHaveValue('dmy');
    await expect(dialog.getByRole('combobox', { name: 'Amounts' })).toHaveValue('comma');
    await expect(dialog.getByRole('combobox', { name: 'Column Buchungstag' })).toHaveValue('date');
    await expect(
      dialog.getByRole('combobox', { name: 'Column Auftraggeber / Empfänger' }),
    ).toHaveValue('payee');
    await expect(dialog.getByRole('combobox', { name: 'Column Betrag' })).toHaveValue('amount');

    await dialog.getByRole('button', { name: 'Preview' }).click();
    await dialog.getByRole('button', { name: 'Import 3 Transactions' }).click();
    await expect(dialog).toContainText('3 imported, 0 skipped');

    const txs = await api.transactions(`?account_id=${checking.id}&from=2025-01-01`);
    const summary = txs
      .map((t) => [t.date, t.payeeName, t.amount, t.notes])
      .sort((a, b) => String(a).localeCompare(String(b)));
    expect(summary).toEqual([
      ['2025-01-15', 'Bäckerei Müller', -450, 'Brötchen'],
      ['2025-01-16', 'Arbeitgeber GmbH', 250_000, 'Gehalt Januar'],
      ['2025-01-17', 'Baumarkt', -108_999, null],
    ]);
  });

  test('asks for the format when the file could be read two ways', async ({ page, api }) => {
    const checking = await api.createAccount('Checking', 0);
    await open(page, `/accounts/${checking.id}`);
    // 01.02.2025 could be January 2 or 1 February; 1.234 could be 1234 or 1.234
    const dialog = await importCsv(page, 'Date;Description;Amount\r\n01.02.2025;Rent;-1.234\r\n');

    await expect(dialog).toContainText('Choose the format your bank uses');
    await dialog.getByRole('button', { name: 'Preview' }).click();
    await expect(dialog).toContainText('Choose how this file writes dates');

    await dialog.getByRole('combobox', { name: 'Dates' }).selectOption('dmy');
    await dialog.getByRole('combobox', { name: 'Amounts' }).selectOption('comma');
    await expect(dialog).not.toContainText('Choose the format your bank uses');
    await dialog.getByRole('button', { name: 'Preview' }).click();
    await dialog.getByRole('button', { name: 'Import 1 Transactions' }).click();
    await expect(dialog).toContainText('1 imported, 0 skipped');

    const [tx] = await api.transactions(`?account_id=${checking.id}&from=2025-01-01`);
    expect([tx.date, tx.amount]).toEqual(['2025-02-01', -123_400]);
  });

  test('unreadable files explain what went wrong', async ({ page, api }) => {
    const checking = await api.createAccount('Checking', 0);
    await open(page, `/accounts/${checking.id}`);
    const dialog = await importCsv(page, 'Name,Notes\r\nfoo,bar\r\n');
    await dialog.getByRole('combobox', { name: 'Column Name' }).selectOption('payee');
    await dialog.getByRole('button', { name: 'Preview' }).click();
    await expect(dialog).toContainText('Date column is required');
    expect(await api.transactions(`?account_id=${checking.id}`)).toHaveLength(0);
  });
});

test.describe('export, backup and restore', () => {
  test('exports transactions as CSV, with formula injection neutralized', async ({ page, api }) => {
    const checking = await api.createAccount('Checking', 0);
    await api.createTransaction({
      accountId: checking.id,
      date: isoDay(),
      amount: -1_000,
      payeeName: '=HYPERLINK("http://evil.example")',
    });
    await open(page, '/settings');
    await page.getByRole('button', { name: 'Data' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download CSV' }).click();
    const csv = fs.readFileSync(await (await download).path(), 'utf8');
    expect(csv.split('\n')[0]).toBe('Date,Account,Payee,Category,Notes,Amount,Reconciled');
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
    expect(csv).toContain('-10.00');
  });

  test('a backup restores everything it contained', async ({ page, api }) => {
    const checking = await api.createAccount('Checking', 50_000);
    await api.createTransaction({
      accountId: checking.id,
      date: isoDay(),
      amount: -2_500,
      payeeName: 'Before Backup',
    });
    await api.call('POST', '/goals', { name: 'Vacation', targetAmount: 200_000 });

    await open(page, '/settings');
    await page.getByRole('button', { name: 'Data' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Backup' }).click();
    const backupFile = await (await download).path();
    const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    expect(backup).toMatchObject({ format: 'flybudget-backup', version: 2 });
    expect(backup.goals).toHaveLength(1);
    // Never any bank credentials or login data
    expect(Object.keys(backup)).not.toContain('plaidItems');
    expect(Object.keys(backup)).not.toContain('sessions');

    // Things change after the backup…
    await api.createTransaction({
      accountId: checking.id,
      date: isoDay(),
      amount: -99_999,
      payeeName: 'After Backup',
    });
    await api.createAccount('New Account', 1);

    // …and restoring brings it back
    await page.getByLabel('Backup file').setInputFiles(backupFile);
    const confirm = page.getByRole('dialog', { name: 'Restore this backup?' });
    await expect(confirm).toContainText('All of your current data will be replaced');
    await confirm.getByRole('button', { name: 'Replace my data' }).click();
    await expect(page.getByRole('status')).toContainText('Restored');
    await expect(page.getByRole('status')).toContainText('1 transactions');

    expect((await api.accounts()).map((a) => a.name)).toEqual(['Checking']);
    expect(await api.balance(checking.id)).toBe(47_500);
    const payees = (await api.transactions()).map((t) => t.payeeName);
    expect(payees).toEqual(['Before Backup']);
    // The sidebar shows the restored data without reloading
    await expect(page.getByRole('complementary')).toContainText('$475');
  });

  test('restoring a file that is not a backup changes nothing', async ({ page, api }) => {
    await api.createAccount('Checking', 50_000);
    await open(page, '/settings');
    await page.getByRole('button', { name: 'Data' }).click();
    await page.getByLabel('Backup file').setInputFiles({
      name: 'notes.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"hello":"world"}'),
    });
    await page
      .getByRole('dialog', { name: 'Restore this backup?' })
      .getByRole('button', { name: 'Replace my data' })
      .click();
    await expect(page.getByRole('status')).toContainText('This is not a FlyBudget backup file');
    expect((await api.accounts()).map((a) => a.name)).toEqual(['Checking']);

    await page.getByLabel('Backup file').setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{not json'),
    });
    await expect(page.getByRole('status')).toContainText(
      'broken.json is not a FlyBudget backup file',
    );
  });
});
