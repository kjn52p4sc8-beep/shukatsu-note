import { buildICS, calEvent, googleUrl } from '../core/calendar';
import { fmtDate } from '../core/dates';
import type { Entry } from '../core/types';
import { fileSafe } from '../ui/files';
import { Modal } from '../ui/Modal';
import { ReminderChecks } from './Reminders';

interface Props {
  entry: Entry;
  reminders: number[];
  onReminders: (next: number[]) => void;
  onSaveFile: (filename: string, text: string, mime: string) => void;
  onClose: () => void;
}

export function CalendarDialog({ entry: it, reminders, onReminders, onSaveFile, onClose }: Props) {
  const now = Date.now();
  return (
    <Modal title="カレンダーに追加" onClose={onClose}>
      <div className="stack">
        {(['deadline', 'event'] as const).map((type) => {
          const ev = calEvent(it, type);
          if (!ev) return null;
          const date = type === 'deadline' ? it.dDate : it.eDate;
          const time = type === 'deadline' ? it.dTime : it.eTime;
          return (
            <div className="calbox" key={type}>
              <span className="ttl">
                {type === 'deadline' ? '申込締切' : '開催日時'}　{fmtDate(date, now)} {time || '（終日の予定として登録）'}
              </span>
              <span className="muted small-text">{ev.title}</span>
              <div className="row">
                <a className="btn small" href={googleUrl(ev)} target="_blank" rel="noopener noreferrer">
                  Googleカレンダーで開く ↗
                </a>
                <button
                  className="btn small" type="button"
                  onClick={() =>
                    onSaveFile(
                      (type === 'deadline' ? '締切_' : '開催_') + fileSafe(it.company) + '.ics',
                      buildICS([ev], reminders, Date.now()),
                      'text/calendar',
                    )
                  }
                >
                  iPhoneなど用 .ics を保存
                </button>
              </div>
            </div>
          );
        })}
        <div className="fg">
          <span className="lbl">.ics に入れるリマインダー</span>
          <ReminderChecks value={reminders} onChange={onReminders} label=".ics に入れるリマインダー" />
          <span className="hint">
            iPhoneでは保存した .ics ファイルを開くとカレンダーに追加できます。Googleカレンダーのリンクでは通知を指定できないため、Google側の既定の通知になります。
          </span>
        </div>
      </div>
    </Modal>
  );
}
