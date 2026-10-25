// Сохранения в интерфейсе: слоты на стартовом экране, файлы (скачать / загрузить) и корзина.
import { useState } from 'preact/hooks';
import { DIFFICULTY } from '../game/defs';
import { fmtDate } from '../game/format';
import {
  activeSlot, deleteSave, exportText, parseSave, restoreTrash, saveFileName, trashInfo, writeSlot, type SlotInfo,
} from '../game/save';
import { SCENARIOS } from '../game/scenarios';
import type { GameState } from '../game/types';
import { COUNTRY_DEFS } from '../game/world';
import { Card, Flag } from './common';

/** Отдать текст файлом: браузер (и программа для Windows) предложит сохранить. */
export function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const downloadGame = (g: GameState) => downloadText(saveFileName(g), exportText(g));

/** Выбрать файл и прочитать его текст (null — передумали). */
function pickFile(): Promise<string | null> {
  return new Promise((done) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return done(null);
      f.text().then(done, () => done(null));
    };
    input.click();
  });
}

const fmtWhen = (t: number) => (t ? new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/** Первый свободный слот, иначе текущий — туда по умолчанию запишется новая игра. */
export function defaultTarget(slots: SlotInfo[]) {
  return slots.find((s) => !s.raw)?.slot ?? activeSlot();
}

/** Слоты на стартовом экране. target — куда запишется новая игра или загруженный файл. */
export function SaveSlots({ slots, target, setTarget, onPlay, refresh }: {
  slots: SlotInfo[];
  target: number;
  setTarget: (k: number) => void;
  onPlay: (g: GameState, slot: number) => void;
  refresh: () => void;
}) {
  const [ask, setAsk] = useState(0); // слот, удаление которого подтверждаем
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const trash = trashInfo();
  const free = slots.find((s) => !s.raw)?.slot ?? 0;
  const load = async () => {
    const text = await pickFile();
    if (text === null) return;
    const p = parseSave(text);
    if ('error' in p) return setMsg({ text: p.error, bad: true });
    const old = slots.find((s) => s.slot === target)?.raw;
    if (!writeSlot(target, p.g)) return setMsg({ text: 'Не удалось записать — хранилище браузера переполнено или недоступно', bad: true });
    setMsg({ text: `Загружено в слот ${target}${old ? ' (прежнее сохранение — в корзине)' : ''}` });
    refresh();
  };
  return (
    <Card title="💾 Сохранения" sub={`новая игра → слот ${target}`}
      hint="Три слота — три партии. Нажмите на слот, чтобы новая игра или загруженный файл записались туда. Удалённое или перезаписанное сохранение попадает в корзину — последнее можно вернуть. «⬇» скачивает сохранение файлом: так партию можно перенести на другой телефон, в браузер или в программу для Windows.">
      {slots.map((s) => (
        <div key={s.slot} class={`slot-row ${target === s.slot ? 'on' : ''}`} onClick={() => setTarget(s.slot)}>
          <span class="slot-n">{s.slot}</span>
          {s.g ? (
            <>
              <Flag id={s.g.player} />
              <div class="grow">
                <b>{COUNTRY_DEFS[s.g.player].name}</b>
                <div class="small muted">
                  {fmtDate(s.g.day)} · {DIFFICULTY[s.g.difficulty].name}{s.g.scenario && s.g.scenario !== 'classic' ? ` · ${SCENARIOS[s.g.scenario].icon} ${SCENARIOS[s.g.scenario].name}` : ''}
                  {s.g.gameOver ? ' · 💀 партия окончена' : ''}
                </div>
              </div>
              {!s.g.gameOver && <button class="btn sm shine" onClick={(e) => { e.stopPropagation(); onPlay(s.g!, s.slot); }}>▶</button>}
            </>
          ) : s.raw ? (
            <div class="grow small down">⚠️ {s.error}</div>
          ) : (
            <div class="grow small muted">Пусто</div>
          )}
          {s.raw && (
            <>
              <button class="btn sm ghost" title="Скачать файлом" onClick={(e) => { e.stopPropagation(); downloadText(s.g ? saveFileName(s.g) : `derzhava-slot${s.slot}.json`, s.g ? exportText(s.g) : s.raw!); }}>⬇</button>
              {ask === s.slot ? (
                <button class="btn sm danger" onClick={(e) => { e.stopPropagation(); deleteSave(s.slot); setAsk(0); setMsg({ text: `Слот ${s.slot} очищен — сохранение в корзине` }); refresh(); }}>Точно?</button>
              ) : (
                <button class="btn sm ghost" title="Удалить (в корзину)" onClick={(e) => { e.stopPropagation(); setAsk(s.slot); }}>🗑</button>
              )}
            </>
          )}
        </div>
      ))}
      <button class="btn ghost block" style={{ marginTop: '8px' }} onClick={load}>📂 Загрузить из файла → слот {target}</button>
      {msg && <div class={`small ${msg.bad ? 'down' : 'up'}`} style={{ marginTop: '6px' }}>{msg.text}</div>}
      {trash && (
        <div class="slot-trash">
          <span>♻️</span>
          <div class="grow small">
            <b>Корзина:</b> {trash.g ? `${COUNTRY_DEFS[trash.g.player].name}, ${fmtDate(trash.g.day)}` : trash.error ?? 'сохранение'}
            <div class="muted">удалено {fmtWhen(trash.when)}</div>
          </div>
          <button class="btn sm ghost" title="Скачать файлом" onClick={() => downloadText(trash.g ? saveFileName(trash.g) : 'derzhava-trash.json', trash.g ? exportText(trash.g) : trash.raw)}>⬇</button>
          <button class="btn sm" disabled={!free} title={free ? undefined : 'Освободите слот'} onClick={() => { const err = restoreTrash(free); setMsg(err ? { text: err, bad: true } : { text: `Восстановлено в слот ${free}` }); refresh(); }}>
            {free ? `Вернуть → ${free}` : 'Нет места'}
          </button>
        </div>
      )}
    </Card>
  );
}
