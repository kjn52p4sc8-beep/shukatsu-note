export type Status = 'undecided' | 'submitted' | 'skipped';

export interface CheckItem {
  id: string;
  text: string;
  done: boolean;
}

/** ES原稿に設定できる文字数の上限 */
export const ES_LIMITS = [300, 400, 600, 800, 1000, 1200, 2000];
export interface ESDraft { id: string; title: string; limit: number; text: string }
export interface InterviewNote { id: string; date: string; round: string; question: string; answer: string; reflection: string }

/** 1件のエントリー（企業 × 締切）。日付・時刻はすべて日本時間の文字列で持つ。 */
export interface Entry {
  id: string;
  company: string;
  kind: string;
  platform: string;
  /** 申込締切 YYYY-MM-DD（未登録は空文字） */
  dDate: string;
  /** 申込締切 HH:MM（時刻未定は空文字） */
  dTime: string;
  /** 開催日 YYYY-MM-DD */
  eDate: string;
  /** 開催時刻 HH:MM */
  eTime: string;
  status: Status;
  step: string;
  checklist: CheckItem[];
  url: string;
  memo: string;
  esDrafts: ESDraft[];
  interviews: InterviewNote[];
  sample: boolean;
  /** この端末で最後に編集した時刻（UTCミリ秒）。同期の勝ち負けを決める。 */
  editedAt: number;
  /** 削除した時刻。削除済みでなければ null。 */
  deletedAt: number | null;
}

export interface Settings {
  /** .ics に書き込むリマインダー（締切の何分前か） */
  icsReminders: number[];
  /** プッシュ通知を送るタイミング（締切の何分前か） */
  pushOffsets: number[];
  editedAt: number;
}

export const PLATFORMS = [
  'マイナビ',
  'リクナビ',
  'キャリタス就活',
  'ワンキャリア',
  '外資就活ドットコム',
  'オープンワーク',
  'Re就活',
  'ビズリーチ',
  '企業マイページ・直接応募',
  'その他',
];
export const KINDS = ['本選考', 'インターン', '説明会'];
export const STEPS = ['エントリー', 'ES提出', '適性検査', '一次面接', '最終面接', '内定'];
export const STATUS_LABEL: Record<Status, string> = {
  undecided: '未定',
  submitted: '提出済み・申込済み',
  skipped: '見送り',
};
/** [分, 表示名] */
export const REMINDERS: [number, string][] = [
  [1440, '前日'],
  [180, '3時間前'],
  [60, '1時間前'],
];
export const DEFAULT_SETTINGS: Settings = { icsReminders: [1440, 180], pushOffsets: [1440, 180], editedAt: 0 };
export const QUICK_CHECKS = ['ES', '顔写真', '適性検査', '履歴書', '成績証明書'];
