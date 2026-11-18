import type { Entry } from './types';
import { STATUS_LABEL } from './types';
import { characterCount } from './companies';

export async function excelBlob(entries: Entry[]): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '就活しめきりボード';
  const sheets: [string, string[], (string | number)[][]][] = [
    ['企業・締切', ['企業名', '内容', 'プラットフォーム', '申込締切日', '申込締切時刻', '開催日', '開催時刻', '状態', '選考ステップ', '提出物', 'マイページURL', 'メモ'], entries.map(e => [e.company, e.kind, e.platform, e.dDate, e.dTime, e.eDate, e.eTime, STATUS_LABEL[e.status], e.step, e.checklist.map(c => `${c.done ? '✓' : '□'} ${c.text}`).join('\n'), e.url, e.memo])],
    ['ESストック', ['企業名', '内容', '設問', '文字数上限', '現在の文字数', '本文'], entries.flatMap(e => e.esDrafts.map(d => [e.company, e.kind, d.title, d.limit, characterCount(d.text), d.text]))],
    ['面接ノート', ['企業名', '内容', '面接日', '段階', '質問', '回答', '振り返り'], entries.flatMap(e => e.interviews.map(d => [e.company, e.kind, d.date, d.round, d.question, d.answer, d.reflection]))],
  ];
  for (const [name, columns, rows] of sheets) {
    const sheet = workbook.addWorksheet(name);
    sheet.addRow(columns); sheet.addRows(rows); // strings stay text; never create Excel formulas from user input.
    sheet.columns.forEach((col, i) => { col.width = i === columns.length - 1 ? 65 : 24; });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    sheet.eachRow((row, n) => {
      row.alignment = { vertical: 'top', wrapText: true };
      if (n === 1) { row.font = { bold: true, color: { argb: 'FFFFFFFF' } }; row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF35665B' } }; }
    });
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function wordBlob(entries: Entry[]): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');
  const lines = (text: string) => text.split(/\r?\n/).map(line => new Paragraph({ children: [new TextRun(line)], spacing: { after: 100 } }));
  const children = [new Paragraph({ text: '就活ノート', heading: HeadingLevel.TITLE })];
  for (const e of entries) {
    children.push(new Paragraph({ text: `${e.company}｜${e.kind}`, heading: HeadingLevel.HEADING_1 }));
    children.push(...lines(`状態：${STATUS_LABEL[e.status]}\n締切：${e.dDate || '未登録'} ${e.dTime}\n開催：${e.eDate || '未登録'} ${e.eTime}\n応募先：${e.platform}\n選考ステップ：${e.step}\nURL：${e.url}\n提出物：${e.checklist.map(c => `${c.done ? '✓' : '□'} ${c.text}`).join('、')}\nメモ：${e.memo}`));
    for (const d of e.esDrafts) {
      children.push(new Paragraph({ text: `ES｜${d.title}（${characterCount(d.text)} / ${d.limit}文字）`, heading: HeadingLevel.HEADING_2 }), ...lines(d.text));
    }
    for (const d of e.interviews) {
      children.push(new Paragraph({ text: `面接｜${d.date} ${d.round}`, heading: HeadingLevel.HEADING_2 }), ...lines(`質問\n${d.question}\n回答\n${d.answer}\n振り返り\n${d.reflection}`));
    }
  }
  return Packer.toBlob(new Document({ sections: [{ children }] }));
}
