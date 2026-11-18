import { describe, expect, it } from 'vitest';
import { itemsFromCSV, itemsFromJSON, legacyIdToUuid, parseBackup, toBackupJSON, toCSV } from '../../src/core/backup';
import { alarmTriggers, allEvents, buildICS, calEvent, foldLine, googleUrl } from '../../src/core/calendar';
import { DAY, HOUR, countdownText, deadlineMs, fmtDate, toMs, urgency, weekRange } from '../../src/core/dates';
import { isUuid, normalizeEntry, pendingEntries, safeUrl, sampleEntries, sortEntries } from '../../src/core/entries';

// 2026-11-16(月) 12:00 JST
const NOW = Date.parse('2026-11-16T12:00:00+09:00');
const entry = (over: Record<string, unknown>) => normalizeEntry({ company: 'A社', ...over }, NOW);

describe('日付と締切', () => {
  it('時刻なしの締切はその日の 23:59:59（日本時間）', () => {
    expect(toMs('2026-11-20', '', true)).toBe(Date.parse('2026-11-20T23:59:59+09:00'));
    expect(toMs('2026-11-20', '09:30', true)).toBe(Date.parse('2026-11-20T09:30:00+09:00'));
    expect(toMs('', '09:30', true)).toBeNull();
  });

  it('今週は月曜0時〜日曜24時（日本時間）', () => {
    const wk = weekRange(NOW);
    expect(wk.start).toBe(Date.parse('2026-11-16T00:00:00+09:00'));
    expect(wk.end).toBe(Date.parse('2026-11-23T00:00:00+09:00'));
    // 日曜の深夜でも同じ週
    expect(weekRange(Date.parse('2026-11-22T23:59:00+09:00'))).toEqual(wk);
  });

  it('緊急度: 24時間以内は赤、今週中はオレンジ', () => {
    expect(urgency(entry({ dDate: '2026-11-17', dTime: '11:00' }), NOW)).toBe('red');
    expect(urgency(entry({ dDate: '2026-11-20', dTime: '11:00' }), NOW)).toBe('orange');
    expect(urgency(entry({ dDate: '2026-11-24' }), NOW)).toBe('normal');
    expect(urgency(entry({ dDate: '2026-11-15' }), NOW)).toBe('expired');
    expect(urgency(entry({}), NOW)).toBe('none');
  });

  it('残り時間の表示', () => {
    expect(countdownText(NOW + 2 * DAY + 3 * HOUR, NOW)).toBe('あと2日3時間');
    expect(countdownText(NOW + 3 * HOUR + 20 * 60000, NOW)).toBe('あと3時間20分');
    expect(countdownText(NOW - 3 * DAY, NOW)).toBe('期限切れ（3日前）');
    expect(fmtDate('2026-11-20', NOW)).toBe('11/20(金)');
    expect(fmtDate('2027-01-05', NOW)).toBe('2027/1/5(火)');
  });
});

describe('エントリー', () => {
  it('外から来たデータを安全な形に直す', () => {
    const e = normalizeEntry({ id: 'abc', company: '  A社 ', status: 'x', dTime: '10:00', url: 'javascript:alert(1)', checklist: [{ text: ' ES ' }, { text: '' }] }, NOW);
    expect(isUuid(e.id)).toBe(true);
    expect(e.company).toBe('A社');
    expect(e.status).toBe('undecided');
    expect(e.dTime).toBe(''); // 日付がないので時刻も捨てる
    expect(e.url).toBe('');
    expect(e.checklist).toHaveLength(1);
    expect(e.checklist[0].text).toBe('ES');
  });

  it('URLは http(s) だけ通す', () => {
    expect(safeUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeUrl('example.com/mypage')).toBe('https://example.com/mypage');
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('data:text/html,x')).toBe('');
  });

  it('締切が近い順 → 期限切れ → 締切なし', () => {
    const list = [
      entry({ company: 'なし' }),
      entry({ company: '切れ', dDate: '2026-11-10' }),
      entry({ company: '遠い', dDate: '2026-12-01' }),
      entry({ company: '近い', dDate: '2026-11-17' }),
    ];
    expect(sortEntries(list, NOW).map((e) => e.company)).toEqual(['近い', '遠い', '切れ', 'なし']);
  });

  it('未提出で締切前のものだけが「未提出」', () => {
    const list = [
      entry({ company: 'a', dDate: '2026-11-17' }),
      entry({ company: 'b', dDate: '2026-11-17', status: 'submitted' }),
      entry({ company: 'c', dDate: '2026-11-10' }),
    ];
    expect(pendingEntries(list, NOW).map((e) => e.company)).toEqual(['a']);
  });

  it('サンプルは5件で、すべてサンプルの印が付く', () => {
    const s = sampleEntries(NOW);
    expect(s).toHaveLength(5);
    expect(s.every((e) => e.sample && isUuid(e.id))).toBe(true);
  });
});

describe('カレンダー書き出し', () => {
  const timed = entry({ company: 'A社', kind: '本選考', dDate: '2026-11-20', dTime: '12:00', eDate: '2026-11-25', eTime: '13:00' });
  const allDay = entry({ company: 'B社', dDate: '2026-11-20' });

  it('時刻ありの締切は、締切の時刻に始まる予定になる', () => {
    const ev = calEvent(timed, 'deadline')!;
    expect(ev.start).toBe(deadlineMs(timed));
    expect(ev.end! - ev.start!).toBe(30 * 60000);
    expect(ev.title).toBe('【締切 12:00】A社 本選考');
  });

  it('リマインダーは、表示どおり締切のちょうど○分前に鳴る（実機評価の不具合）', () => {
    // TRIGGER（-PT…M / -PT…H / PT…M）を、鳴る時刻（UTCミリ秒）に直す
    const fireAt = (startMs: number, trigger: string) => {
      const m = trigger.match(/^(-?)PT(\d+)([MH])$/)!;
      const ms = Number(m[2]) * (m[3] === 'H' ? 3600e3 : 60e3);
      return startMs + (m[1] ? -ms : ms);
    };
    const D = deadlineMs(timed)!;
    const ev = calEvent(timed, 'deadline')!;
    for (const [r, label] of [[10080, '7日前'], [4320, '3日前'], [1440, '前日'], [180, '3時間前'], [60, '1時間前']] as const) {
      const [t] = alarmTriggers(ev, [r]);
      expect(fireAt(ev.start!, t), label).toBe(D - r * 60000);
    }
    // 開催（時刻あり）も、開催の時刻から数える
    const event = calEvent(timed, 'event')!;
    expect(fireAt(event.start!, alarmTriggers(event, [60])[0])).toBe(Date.parse('2026-11-25T12:00:00+09:00'));
  });

  it('23:59締切の予定は、日付をまたがない', () => {
    const late = entry({ dDate: '2026-11-20', dTime: '23:59' });
    const ev = calEvent(late, 'deadline')!;
    expect(ev.start).toBe(Date.parse('2026-11-20T23:59:00+09:00'));
    expect(ev.end).toBe(Date.parse('2026-11-20T23:59:59+09:00'));
  });

  it('終日の締切: 日単位はその日の朝9時、3時間前は当日21時', () => {
    const ev = calEvent(allDay, 'deadline')!;
    expect(ev.allDay).toBe(true);
    // 予定の開始（その日の0:00）から数える：前日9時＝-15時間、3日前9時＝-63時間、7日前9時＝-159時間
    expect(alarmTriggers(ev, [1440, 180])).toEqual(['-PT15H', 'PT1260M']);
    expect(alarmTriggers(ev, [4320, 10080])).toEqual(['-PT63H', '-PT159H']);
  });

  it('.ics は CRLF で、長い行は75バイトで折り返す', () => {
    const ics = buildICS(allEvents([timed, allDay]), [1440], NOW);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics).toContain('DTSTART:20261120T030000Z');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261120');
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(foldLine('あ'.repeat(30))).toContain('\r\n ');
  });

  it('見送りは書き出さない', () => {
    expect(allEvents([entry({ dDate: '2026-11-20', status: 'skipped' })])).toHaveLength(0);
  });

  it('Googleカレンダーのリンク', () => {
    const url = googleUrl(calEvent(allDay, 'deadline')!);
    expect(url).toContain('dates=20261120/20261121');
    expect(url).toContain('ctz=Asia%2FTokyo');
  });
});

describe('バックアップ', () => {
  const items = [
    entry({ company: 'カンマ,と"引用"', kind: '本選考', platform: 'マイナビ', dDate: '2026-11-20', dTime: '12:00', memo: '1行目\n2行目', checklist: [{ text: 'ES', done: true }, { text: '顔写真' }], url: 'https://example.com' }),
    entry({ company: 'B社', status: 'submitted', step: 'ES提出' }),
  ];

  it('CSV は書き出して読み込むと元に戻る', () => {
    const back = itemsFromCSV(toCSV(items), NOW).map((x) => x.entry);
    expect(back).toHaveLength(2);
    expect(back[0]).toMatchObject({ id: items[0].id, company: 'カンマ,と"引用"', dDate: '2026-11-20', dTime: '12:00', memo: '1行目\n2行目', url: 'https://example.com' });
    expect(back[0].checklist.map((c) => [c.text, c.done])).toEqual([['ES', true], ['顔写真', false]]);
    expect(back[1]).toMatchObject({ status: 'submitted', step: 'ES提出' });
  });

  it('JSON は書き出して読み込むと元に戻る', () => {
    const back = itemsFromJSON(toBackupJSON(items, NOW), NOW);
    expect(back.map((x) => x.entry.id)).toEqual(items.map((e) => e.id));
    expect(back.every((x) => x.legacyId === '')).toBe(true);
  });

  it('以前のブラウザ保存版のバックアップも読める（IDは作り直す）', async () => {
    const old = JSON.stringify({ app: 'shukatsu-shimekiri', version: 1, items: [{ id: 'mhx1abc123', company: '旧データ社', dDate: '2026-12-01', status: 'undecided', checklist: [] }] });
    const [x] = parseBackup('backup.json', old, NOW);
    expect(x.legacyId).toBe('mhx1abc123');
    const a = await legacyIdToUuid('user-1', x.legacyId);
    // 同じ人が同じファイルを読み込めば同じIDになる（二重登録にならない）
    expect(await legacyIdToUuid('user-1', x.legacyId)).toBe(a);
    expect(await legacyIdToUuid('user-2', x.legacyId)).not.toBe(a);
    expect(isUuid(a)).toBe(true);
  });

  it('形式が違うファイルはエラーにする', () => {
    expect(() => itemsFromJSON('{"foo":1}')).toThrow();
    expect(() => itemsFromCSV('a,b\n1,2')).toThrow('企業名');
  });
});

describe('不正な締切の取り込み', () => {
  it('存在しない日付と範囲外の時刻を採用しない', () => {
    for (const date of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '0000-01-01']) {
      expect(toMs(date, '', true)).toBeNull();
      expect(entry({ dDate: date }).dDate).toBe('');
    }
    expect(toMs('2028-02-29', '23:59', true)).not.toBeNull();
    for (const time of ['24:00', '12:60', '99:99']) {
      expect(toMs('2026-11-20', time, true)).toBeNull();
      expect(entry({ dDate: '2026-11-20', dTime: time }).dTime).toBe('');
    }
  });
});
