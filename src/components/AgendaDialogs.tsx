import React, { useMemo, useState } from 'react';
import { client } from '../api/client';
import { zonedAllDayRange, zonedLocalToEpoch, localDateTimeInZone } from '../../shared/zoned-time';
import { daysUntilMonday, localPreset, shiftLocal } from '../../shared/task-agenda';
import { NotePicker } from './NotePicker';
import { useDialogFocus } from '../hooks/useDialogFocus';

const saveShortcut = (save: () => void) => (event: React.KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); save(); }
};

export type TaskDraft = { id?: string; noteId: string; title: string; dueAt: number | null; reminderAt: number | null; recurrence?:import("../../shared/recurrence").Recurrence; priority?:import("../../shared/recurrence").Priority; timeZone?:string };
export function TaskDialog({ initialNoteId, initial, onClose, onSaved }: { initialNoteId?: string | null; initial?: TaskDraft; onClose: () => void; onSaved: () => void }) {
  const zone = initial?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [draft, setDraft] = useState<TaskDraft>(initial ?? { noteId: initialNoteId ?? '', title: '', dueAt: null, reminderAt: null });
  const [dueInput, setDueInput] = useState(initial?.dueAt ? localDateTimeInZone(initial.dueAt, zone) : '');
  const initialReminder = initial?.reminderAt ? localDateTimeInZone(initial.reminderAt, zone) : '';
  const [reminderInput, setReminderInput] = useState(initialReminder);
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const root = useDialogFocus(true, () => { if (!saving) onClose(); });
  const save = async () => {
    if (saving) return;
    setError('');
    if (!draft.title.trim()) { setError('Informe um título.'); return; }
    if (!draft.noteId) { setError('Selecione uma nota.'); return; }
    setSaving(true);
    try {
      const dueAt = dueInput ? zonedLocalToEpoch(dueInput, zone) : null;
      const reminderAt = reminderInput ? zonedLocalToEpoch(reminderInput, zone) : null;
      if(draft.recurrence&&draft.recurrence!=='none'&&dueAt===null)throw new Error('Defina um prazo para repetir a tarefa.');
      const repeating={recurrence:draft.recurrence??'none',priority:draft.priority??'normal',timeZone:zone};
      if (draft.id) await client.updateTask({ id: draft.id, noteId: draft.noteId, title: draft.title.trim(), dueAt, reminderAt, ...repeating });
      else await client.createTask({ ...draft, title: draft.title.trim(), dueAt, reminderAt, ...repeating });
      onSaved();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };
  // Shortcuts are civil dates in the task's own zone, so they stay right when editing a task saved elsewhere.
  const presets = useMemo(() => {
    const now = Date.now(), beforeSix = Number(localDateTimeInZone(now, zone).slice(11, 13)) < 18;
    const list: [string, string][] = [];
    if (beforeSix) list.push(['Hoje à noite', localPreset(zone, now, 0, 18)]);
    list.push(['Amanhã', localPreset(zone, now, 1, 9)], ['Próxima segunda', localPreset(zone, now, daysUntilMonday(zone, now), 9)], ['Em 1 semana', localPreset(zone, now, 7, 9)]);
    return list;
  }, [zone]);
  const reminderPresets: [string, number][] = [['15 min antes', -15], ['1 h antes', -60], ['1 dia antes', -1440]];
  const reminderIsPast = (() => { if (!reminderInput || reminderInput === initialReminder) return false; try { return zonedLocalToEpoch(reminderInput, zone) <= Date.now(); } catch { return false; } })();
  const repeating = !!draft.recurrence && draft.recurrence !== 'none';
  return <div className="overlay dialog-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose(); }}><section ref={root} className="modal agenda-dialog task-dialog" role="dialog" aria-modal="true" aria-labelledby="task-dialog-title" onKeyDown={saveShortcut(() => void save())}>
    <header className="dlg-head"><h3 id="task-dialog-title">{draft.id ? 'Editar tarefa' : 'Nova tarefa'}</h3><p>Defina a ação e escolha a nota que reúne o contexto.</p></header>
    <div className="dlg-field"><label htmlFor="task-title">Título</label><input id="task-title" className="dlg-title" maxLength={300} value={draft.title} placeholder="O que precisa ser feito?" onChange={e => setDraft({ ...draft, title: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }}/></div>
    <NotePicker value={draft.noteId ? { id: draft.noteId, title: '' } : null} onChange={note => setDraft({ ...draft, noteId: note?.id ?? '' })}/>
    <div className="dlg-grid">
      <div className="dlg-field"><label htmlFor="task-due">Prazo</label><input id="task-due" type="datetime-local" value={dueInput} onChange={e => setDueInput(e.target.value)}/><div className="dlg-chips" aria-label="Atalhos de prazo">{presets.map(([label, value]) => <button type="button" key={label} className={dueInput === value ? 'on' : undefined} onClick={() => setDueInput(value)}>{label}</button>)}{dueInput && <button type="button" onClick={() => setDueInput('')}>Limpar</button>}</div></div>
      <div className="dlg-field"><label htmlFor="task-reminder">Lembrete</label><input id="task-reminder" type="datetime-local" value={reminderInput} onChange={e => setReminderInput(e.target.value)}/><div className="dlg-chips" aria-label="Atalhos de lembrete">{dueInput && <button type="button" className={reminderInput === dueInput ? 'on' : undefined} onClick={() => setReminderInput(dueInput)}>No prazo</button>}{dueInput && reminderPresets.map(([label, minutes]) => <button type="button" key={label} className={reminderInput === shiftLocal(dueInput, minutes) ? 'on' : undefined} onClick={() => setReminderInput(shiftLocal(dueInput, minutes))}>{label}</button>)}{reminderInput && <button type="button" onClick={() => setReminderInput('')}>Limpar</button>}</div></div>
    </div>
    {reminderIsPast && <p className="dlg-help dlg-warn">Este horário já passou: o lembrete será entregue assim que o app verificar.</p>}
    <div className="dlg-grid"><div className="dlg-field"><label htmlFor="task-repeat">Repetir</label><select id="task-repeat" value={draft.recurrence??'none'} onChange={e=>setDraft({...draft,recurrence:e.target.value as TaskDraft['recurrence']})}><option value="none">Não repetir</option><option value="daily">Diariamente</option><option value="weekly">Semanalmente</option><option value="monthly">Mensalmente</option></select></div><div className="dlg-field"><label htmlFor="task-priority">Prioridade</label><select id="task-priority" value={draft.priority??'normal'} onChange={e=>setDraft({...draft,priority:e.target.value as TaskDraft['priority']})}><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option></select></div></div>
    {repeating && !dueInput && <p className="dlg-help dlg-warn">Defina um prazo para repetir a tarefa.</p>}
    {repeating && <p className="dlg-help">Ao concluir, será criada uma única próxima ocorrência futura no fuso {zone}. O horário será mantido; meses mais curtos usam o último dia.</p>}
    {error && <p role="alert" className="dlg-error">{error}</p>}
    <div className="row"><span className="dlg-hint">Ctrl+Enter salva</span><button disabled={saving} onClick={onClose}>Cancelar</button><button className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Salvando…' : 'Salvar tarefa'}</button></div>
  </section></div>;
}

export type EventDraft = { id?: string; noteId: string | null; title: string; description: string; startAt: number; endAt: number; timeZone: string; allDay: boolean };

const minutesBetween = (from: string, to: string) => (Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10), +(to.slice(11, 13) || 0), +(to.slice(14, 16) || 0)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10), +(from.slice(11, 13) || 0), +(from.slice(14, 16) || 0))) / 60000;
const isZone = (zone: string) => { try { new Intl.DateTimeFormat(undefined, { timeZone: zone }); return zone.trim().length > 0; } catch { return false; } };
let zoneNames: string[] | undefined;
const knownZones = () => zoneNames ??= (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
const offsetOf = (zone: string, epoch: number) => { try { return new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(epoch).find(part => part.type === 'timeZoneName')?.value.replace('GMT', 'UTC') ?? ''; } catch { return ''; } };
/** Keeps the clock part of a `datetime-local` value while a date-only input edits the day. */
const withDate = (previous: string, date: string) => !date || date.length > 10 ? date : `${date}${previous.length > 10 ? previous.slice(10) : 'T00:00'}`;
const full = (value: string) => value.length > 10 ? value : `${value}T00:00`;

export function EventDialog({ initial, onClose, onSaved }: { initial?: EventDraft; onClose: () => void; onSaved: () => void }) {
  const zoneDefault = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const base = initial ?? { noteId: null, title: '', description: '', startAt: Date.now() + 3600000, endAt: Date.now() + 7200000, timeZone: zoneDefault, allDay: false };
  const [draft, setDraft] = useState(base);
  const [start, setStart] = useState(initial ? localDateTimeInZone(initial.startAt, initial.timeZone) : localDateTimeInZone(base.startAt, zoneDefault));
  const [end, setEnd] = useState(initial ? localDateTimeInZone(initial.endAt, initial.timeZone) : localDateTimeInZone(base.endAt, zoneDefault));
  const [zoneText, setZoneText] = useState(base.timeZone);
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const root = useDialogFocus(true, () => { if (!saving) onClose(); });
  const zoneValid = isZone(zoneText);
  const zoneChanged = (text: string) => {
    setZoneText(text);
    const zone = text.trim();
    if (!isZone(zone) || zone === draft.timeZone) return;
    // Timed events keep their instant when the zone changes; all-day events keep their calendar dates.
    if (!draft.allDay) {
      try {
        const nextStart = start ? localDateTimeInZone(zonedLocalToEpoch(start, draft.timeZone), zone) : start;
        const nextEnd = end ? localDateTimeInZone(zonedLocalToEpoch(end, draft.timeZone), zone) : end;
        setStart(nextStart); setEnd(nextEnd);
      } catch { /* a skipped DST hour cannot be converted; keep the typed values */ }
    }
    setDraft({ ...draft, timeZone: zone });
  };
  // Moving the start drags the end along, so the duration survives and the end never lands before the start.
  const changeStart = (value: string) => {
    const next = withDate(start, value);
    if (next && start && end && full(end) >= full(start)) setEnd(shiftLocal(full(end), minutesBetween(full(start), full(next))));
    setStart(next);
  };
  const duration = start && end && !draft.allDay ? minutesBetween(start, end) : null;
  const save = async () => {
    if (saving) return;
    setError('');
    if (!draft.title.trim()) { setError('Informe um título.'); return; }
    if (!zoneValid) { setError('Fuso horário desconhecido. Use um nome IANA, como America/Sao_Paulo.'); return; }
    try {
      let values: { startAt: number; endAt: number };
      if (draft.allDay) values = zonedAllDayRange(start.slice(0, 10), end.slice(0, 10), draft.timeZone);
      else { values = { startAt: zonedLocalToEpoch(start, draft.timeZone), endAt: zonedLocalToEpoch(end, draft.timeZone) }; if (values.endAt < values.startAt) throw Error('O fim deve ser posterior ao início.'); }
      setSaving(true);
      const payload = { ...draft, ...values, title: draft.title.trim() };
      if (draft.id) await client.updateEvent({ ...payload, id: draft.id }); else await client.createEvent(payload);
      onSaved();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };
  const dateType = draft.allDay ? 'date' : 'datetime-local';
  const offset = zoneValid && start && !draft.allDay ? (() => { try { return offsetOf(zoneText.trim(), zonedLocalToEpoch(start, zoneText.trim())); } catch { return ''; } })() : '';
  return <div className="overlay dialog-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose(); }}><section ref={root} className="modal agenda-dialog event-dialog" role="dialog" aria-modal="true" aria-labelledby="event-dialog-title" onKeyDown={saveShortcut(() => void save())}>
    <header className="dlg-head"><h3 id="event-dialog-title">{draft.id ? 'Editar evento' : 'Novo evento'}</h3><p>Escolha o período e, se precisar, vincule uma nota.</p></header>
    <div className="dlg-field"><label htmlFor="event-title">Título</label><input id="event-title" maxLength={300} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }}/></div>
    <div className="dlg-field"><label htmlFor="event-description">Descrição</label><textarea id="event-description" value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })}/></div>
    <label><input type="checkbox" checked={draft.allDay} onChange={e => setDraft({ ...draft, allDay: e.target.checked })}/> Dia inteiro</label>
    <div className="dlg-grid"><div className="dlg-field"><label htmlFor="event-start">Início</label><input id="event-start" type={dateType} value={draft.allDay ? start.slice(0, 10) : start} onChange={e => changeStart(e.target.value)}/></div><div className="dlg-field"><label htmlFor="event-end">Fim</label><input id="event-end" type={dateType} value={draft.allDay ? end.slice(0, 10) : end} onChange={e => setEnd(withDate(end, e.target.value))}/></div></div>
    {!draft.allDay && start && <div className="dlg-chips" aria-label="Duração rápida">{([['30 min', 30], ['1 h', 60], ['2 h', 120]] as const).map(([label, minutes]) => <button type="button" key={label} className={duration === minutes ? 'on' : undefined} onClick={() => setEnd(shiftLocal(start, minutes))}>{label}</button>)}</div>}
    <div className="dlg-field"><label htmlFor="event-zone">Fuso horário IANA</label><input id="event-zone" list="agenda-zones" autoComplete="off" spellCheck={false} aria-invalid={!zoneValid} value={zoneText} onChange={e => zoneChanged(e.target.value)}/><datalist id="agenda-zones">{knownZones().map(name => <option key={name} value={name}/>)}</datalist>{!zoneValid ? <p className="dlg-help dlg-warn">Fuso desconhecido. Exemplos: America/Sao_Paulo, Europe/Lisbon, UTC.</p> : offset && <p className="dlg-help">{offset} na data de início. Ao mudar o fuso, o horário é convertido e o instante do evento se mantém.</p>}</div>
    <NotePicker value={draft.noteId ? { id: draft.noteId, title: '' } : null} onChange={note => setDraft({ ...draft, noteId: note?.id ?? null })} optional/>
    {error && <p role="alert" className="dlg-error">{error}</p>}
    <div className="row"><span className="dlg-hint">Ctrl+Enter salva</span><button disabled={saving} onClick={onClose}>Cancelar</button><button className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Salvando…' : 'Salvar evento'}</button></div>
  </section></div>;
}
