/** メール由来の候補。公式サイトで確認済みとは扱わず、承認前は通知しない。 */
export interface MailCandidate {
  company: string; kind: string; date: string; time: string; evidence: string;
  links: string[]; reason: string;
}
export interface MailInput { subject: string; from: string; text: string; receivedAt: string }
const pad = (n: number) => String(n).padStart(2, '0');
function validDate(s: string) {
  const n = Date.parse(s + 'T00:00:00Z');
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === s;
}
export function htmlToText(html: string) {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<\/?(?:br|p|div|li|tr|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}
export function parseMail(input: MailInput): MailCandidate[] {
  const text = (input.subject + '\n' + input.text).normalize('NFKC').slice(0, 100000);
  const links = [...new Set(text.match(/https?:\/\/[^\s<>"'）)]+/g) ?? [])].slice(0, 5).filter(s => {
    try { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; }
  });
  const explicitCompany = text.match(/(?:企業名|会社名)\s*[:：]\s*([^\n]{1,100})/);
  const senderCompany = input.from.match(/^\s*"?(.+?)(?:\s*採用[^<]*|\s*人事[^<]*)?"?\s*</)?.[1] ?? '';
  const company = (explicitCompany?.[1] ?? (/株式会社|合同会社|有限会社/.test(senderCompany) ? senderCompany : '')).trim().slice(0, 100);
  const out: MailCandidate[] = [];
  const lines = text.split(/\n/).map(s => s.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Generic subjects such as ‘ES締切のご案内’ are context, not a second deadline.
    if (i === 0 && line === input.subject.normalize('NFKC').trim() && !/\d{1,2}[月/-]\d{1,2}/.test(line)) continue;
    // 署名・開催日・引用メールの日付を締切にしない。年の省略や相対日は確認に回す。
    if (!/締[め]?切|〆切|提出期限|応募期限|申込期限|予約期限/.test(line)) continue;
    const evidence = (line + (/\d{1,2}[月/-]\d{1,2}/.test(line) ? '' : '\n' + (lines[i + 1] ?? ''))).slice(0, 500);
    const matches = [...evidence.matchAll(/(?<!\d)(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})日?/g)];
    const m = matches.length === 1 ? matches[0] : null;
    const candidateDate = m ? `${m[1]}-${pad(+m[2])}-${pad(+m[3])}` : '';
    const date = candidateDate && validDate(candidateDate) ? candidateDate : '';
    const tm = evidence.match(/(?:午前|午後)?\s*(\d{1,2})(?::|時)(\d{1,2})?分?/);
    let hour = tm ? Number(tm[1]) : 0;
    if (tm?.[0].includes('午後') && hour < 12) hour += 12;
    if (tm?.[0].includes('午前') && hour === 12) hour = 0;
    const minute = tm?.[2] ? Number(tm[2]) : 0;
    const foreignZone = /UTC|GMT|PST|PDT|EST|EDT|米国|現地時間/i.test(evidence);
    const time = date && tm && hour < 24 && minute < 60 && !foreignZone ? `${pad(hour)}:${pad(minute)}` : '';
    const kind = /適性|web.?テスト|SPI/i.test(evidence) ? '適性検査' : /ES|エントリーシート/i.test(evidence) ? 'ES提出' : /面接/.test(evidence) ? '面接予約' : '応募';
    out.push({ company, kind, date: foreignZone ? '' : date, time, evidence, links,
      reason: foreignZone ? '海外の時刻表記です。日本時間への確認が必要です。' : !date ? '年の省略・複数日付・不正な日付があります。締切を確認してください。' : !time ? '日付の候補です。時刻は原文を確認してください。' : 'メールから読み取った候補です。募集コースと期限を確認してください。' });
    if (out.length >= 10) break;
  }
  if (!out.length) out.push({ company, kind: '応募', date: '', time: '', evidence: text.slice(0, 500), links, reason: '締切を特定できません。本文やマイページを確認してください。' });
  return out;
}
export interface GmailPart { mimeType?: string; filename?: string; body?: { data?: string }; parts?: GmailPart[] }
export function decodeBase64url(s: string): string {
  const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(raw, c => c.charCodeAt(0)));
}
export function gmailText(part: GmailPart, depth = 0): string {
  if (depth > 12 || part.filename) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return decodeBase64url(part.body.data).slice(0, 100000);
  if (part.mimeType === 'text/html' && part.body?.data) return htmlToText(decodeBase64url(part.body.data)).slice(0, 100000);
  const parts = part.parts ?? [];
  if (part.mimeType === 'multipart/alternative') return gmailText(parts.find(p => p.mimeType === 'text/plain') ?? parts[0] ?? {}, depth + 1);
  return parts.map(p => gmailText(p, depth + 1)).join('\n').slice(0, 100000);
}
