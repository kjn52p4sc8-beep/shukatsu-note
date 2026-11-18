import { describe, expect, it } from 'vitest';
import { formatDateInput, parseDateInput, parseTimeInput } from '../../src/core/parse';

// 2026-11-18（水）12:00 日本時間
const NOW = Date.parse('2026-11-18T12:00:00+09:00');

describe('日付の直接入力', () => {
  it('よく使う書き方を YYYY-MM-DD に直す', () => {
    for (const s of ['2026-11-20', '2026/11/20', '2026.11.20', '2026年11月20日', '20261120', '２０２６／１１／２０', ' 2026/11/20(金) ', '2026/11/20（金）']) {
      expect(parseDateInput(s, NOW), s).toBe('2026-11-20');
    }
  });
  it('年を省くと、近い将来の日付にする', () => {
    expect(parseDateInput('11/20', NOW)).toBe('2026-11-20');
    expect(parseDateInput('1120', NOW)).toBe('2026-11-20');
    expect(parseDateInput('12月1日', NOW)).toBe('2026-12-01');
    // 1か月以上前の日付は来年とみなす
    expect(parseDateInput('3/1', NOW)).toBe('2027-03-01');
    // 少し前の日付（期限切れの登録など）は今年のまま
    expect(parseDateInput('11/10', NOW)).toBe('2026-11-10');
  });
  it('存在しない日付や読めない文字は null', () => {
    for (const s of ['2026/02/30', '2026/13/01', 'あした', '', '11/20/2026']) expect(parseDateInput(s, NOW), s).toBeNull();
  });
  it('表示は 2026/11/20 の形', () => {
    expect(formatDateInput('2026-11-20')).toBe('2026/11/20');
    expect(formatDateInput('11/2')).toBe('11/2');
  });
});

describe('時刻の直接入力', () => {
  it('よく使う書き方を HH:MM に直す', () => {
    const cases: [string, string][] = [['18:00', '18:00'], ['18：00', '18:00'], ['1830', '18:30'], ['18', '18:00'], ['18時', '18:00'], ['18時30分', '18:30'], ['9:5', '09:05'], ['０９：００', '09:00']];
    for (const [s, want] of cases) expect(parseTimeInput(s), s).toBe(want);
  });
  it('範囲外は null', () => {
    for (const s of ['24:00', '12:60', '99', 'ゆうがた', '']) expect(parseTimeInput(s), s).toBeNull();
  });
});
