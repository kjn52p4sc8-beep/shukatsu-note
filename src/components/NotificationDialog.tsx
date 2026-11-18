import type { Settings } from '../core/types';
import { Modal } from '../ui/Modal';
import { PushSection } from './PushSection';
import { ReminderChecks } from './Reminders';
export function NotificationDialog({ settings, onChange, onClose }: { settings: Settings; onChange: (patch: Partial<Settings>) => void; onClose: () => void }) {
  return <Modal title="通知・リマインダー" onClose={onClose}>
    <PushSection offsets={settings.pushOffsets} onOffsets={pushOffsets => onChange({ pushOffsets })} />
    <section><h3>カレンダーの通知</h3><p>カレンダーへ渡す .ics ファイルに、選んだ通知を含めます。</p>
      <ReminderChecks label="カレンダー通知のタイミング" value={settings.icsReminders} onChange={icsReminders => onChange({ icsReminders })} />
      <p className="muted">Googleカレンダーの追加画面では、Google側の通知設定を確認してください。アプリの通知設定とは別になります。</p>
    </section>
  </Modal>;
}
