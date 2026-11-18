import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { companySuggestions, characterCount, gmailUrl } from '../../src/core/companies';
import { normalizeEntry } from '../../src/core/entries';
import { itemsFromCSV, itemsFromJSON, toCSV, toBackupJSON } from '../../src/core/backup';
import { entryToRow, rowToEntry } from '../../src/data/remote';
import { excelBlob, wordBlob } from '../../src/core/office';

const entry = () => normalizeEntry({ company: '=SUM(1,2)', memo: 'メモ & <安全>', esDrafts: [{ title: '自己PR', limit: 300, text: '私の強み\n伝えたいこと & < >' }], interviews: [{ date: '2026-11-16', round: '一次面接', question: 'なぜ当社？', answer: '理由です', reflection: '次に活かす' }] });

describe('企業候補と文字数', () => {
  it('1文字・ひらがな・カタカナ・全角英字から候補が出て、登録企業を優先する', () => {
    expect(companySuggestions('と', [])).toContain('トヨタ自動車');
    expect(companySuggestions('トヨ', [])).toContain('トヨタ自動車');
    expect(companySuggestions('ＳＯＮＹ', [])).toContain('ソニー');
    expect(companySuggestions('独', ['独自の会社'])[0]).toBe('独自の会社');
    expect(companySuggestions('', ['独自の会社'])).toEqual([]);
  });
  it('絵文字は1文字、改行は除外、空白は含める', () => {
    expect(characterCount('あ\r\nい 😀')).toBe(4);
  });
  it('企業名をGmailの検索クエリとして符号化する', () => {
    expect(decodeURIComponent(gmailUrl('A&B / 商事').split('#search/')[1])).toBe('"A&B / 商事"');
  });
});

describe('新しいノートの保存・同期・持ち出し', () => {
  it('古いデータでは空のノートを補い、同期とバックアップで原稿を失わない', () => {
    expect(normalizeEntry({ company: '旧データ' })).toMatchObject({ esDrafts: [], interviews: [] });
    const e = entry();
    expect(rowToEntry(entryToRow(e))).toEqual(e);
    expect(itemsFromJSON(toBackupJSON([e], Date.now()))[0].entry.esDrafts).toEqual(e.esDrafts);
    expect(itemsFromCSV(toCSV([e]))[0].entry.interviews).toEqual(e.interviews);
    expect(itemsFromCSV(toCSV([e]))[0].entry.esDrafts).toEqual(e.esDrafts);
  });
  it('Excelには3シートを作り、数式に見える企業名も文字列として保つ', async () => {
    const e = entry();
    const blob = await excelBlob([e]);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await blob.arrayBuffer());
    expect(book.worksheets.map(s => s.name)).toEqual(['企業・締切', 'ESストック', '面接ノート']);
    expect(book.getWorksheet(1)!.getCell('A2').value).toBe('=SUM(1,2)');
    expect(book.getWorksheet(2)!.getCell('F2').value).toBe(e.esDrafts[0].text);
    expect(book.getWorksheet(3)!.getCell('G2').value).toBe('次に活かす');
  });
  it('Wordの本文に企業・ES・面接記録を含め、XMLの記号を安全に出力する', async () => {
    const blob = await wordBlob([entry()]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('私の強み');
    expect(xml).toContain('なぜ当社？');
    expect(xml).toContain('次に活かす');
    expect(xml).toContain('&amp; &lt;安全&gt;');
  });
});
