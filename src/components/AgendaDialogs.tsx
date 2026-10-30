import React, { useState } from 'react';
import { client } from '../api/client';
import { zonedAllDayRange, zonedLocalToEpoch, localDateTimeInZone } from '../../shared/zoned-time';
import { NotePicker } from './NotePicker';
import { useDialogFocus } from '../hooks/useDialogFocus';

export type TaskDraft = { id?: string; noteId: string; title: string; dueAt: number | null; reminderAt: number | null; recurrence?:import("../../shared/recurrence").Recurrence; priority?:import("../../shared/recurrence").Priority; timeZone?:string };
export function TaskDialog({ initialNoteId, initial, onClose, onSaved }: { initialNoteId?: string | null; initial?: TaskDraft; onClose: () => void; onSaved: () => void }) {
  const zone = initial?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [draft, setDraft] = useState<TaskDraft>(initial ?? { noteId: initialNoteId ?? '', title: '', dueAt: null, reminderAt: null });
  const [dueInput, setDueInput] = useState(initial?.dueAt ? localDateTimeInZone(initial.dueAt, zone) : '');
  const [reminderInput, setReminderInput] = useState(initial?.reminderAt ? localDateTimeInZone(initial.reminderAt, zone) : '');
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
  const fmtLocal = (d: Date) => { const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const preset = (days: number, hour: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return fmtLocal(d); };
  const duePresets: [string, string][] = [['Hoje à noite', preset(0, 18)], ['Amanhã', preset(1, 9)], ['Em 1 semana', preset(7, 9)]];
  return <div className="overlay dialog-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose(); }}><section ref={root} className="modal agenda-dialog task-dialog" role="dialog" aria-modal="true" aria-labelledby="task-dialog-title">
    <header className="dlg-head"><h3 id="task-dialog-title">{draft.id ? 'Editar tarefa' : 'Nova tarefa'}</h3><p>Defina a ação e escolha a nota que reúne o contexto.</p></header>
    <div className="dlg-field"><label htmlFor="task-title">Título</label><input id="task-title" className="dlg-title" value={draft.title} placeholder="O que precisa ser feito?" onChange={e => setDraft({ ...draft, title: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }}/></div>
    <NotePicker value={draft.noteId ? { id: draft.noteId, title: '' } : null} onChange={note => setDraft({ ...draft, noteId: note?.id ?? '' })}/>
    <div className="dlg-grid">
      <div className="dlg-field"><label htmlFor="task-due">Prazo</label><input id="task-due" type="datetime-local" value={dueInput} onChange={e => setDueInput(e.target.value)}/><div className="dlg-chips" aria-label="Atalhos de prazo">{duePresets.map(([label, value]) => <button type="button" key={label} className={dueInput === value ? 'on' : undefined} onClick={() => setDueInput(value)}>{label}</button>)}{dueInput && <button type="button" onClick={() => setDueInput('')}>Limpar</button>}</div></div>
      <div className="dlg-field"><label htmlFor="task-reminder">Lembrete</label><input id="task-reminder" type="datetime-local" value={reminderInput} onChange={e => setReminderInput(e.target.value)}/><div className="dlg-chips" aria-label="Atalhos de lembrete">{dueInput && <button type="button" className={reminderInput === dueInput ? 'on' : undefined} onClick={() => setReminderInput(dueInput)}>No prazo</button>}{reminderInput && <button type="button" onClick={() => setReminderInput('')}>Limpar</button>}</div></div>
    </div>
    <div className="dlg-grid"><div className="dlg-field"><label htmlFor="task-repeat">Repetir</label><select id="task-repeat" value={draft.recurrence??'none'} onChange={e=>setDraft({...draft,recurrence:e.target.value as TaskDraft['recurrence']})}><option value="none">Não repetir</option><option value="daily">Diariamente</option><option value="weekly">Semanalmente</option><option value="monthly">Mensalmente</option></select></div><div className="dlg-field"><label htmlFor="task-priority">Prioridade</label><select id="task-priority" value={draft.priority??'normal'} onChange={e=>setDraft({...draft,priority:e.target.value as TaskDraft['priority']})}><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option></select></div></div>
    {draft.recurrence&&draft.recurrence!=='none'&&<p className="dlg-help">Ao concluir, será criada uma única próxima ocorrência futura no fuso {zone}. O horário será mantido; meses mais curtos usam o último dia.</p>}
    {error && <p role="alert" className="dlg-error">{error}</p>}
    <div className="row"><button disabled={saving} onClick={onClose}>Cancelar</button><button className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Salvando…' : 'Salvar tarefa'}</button></div>
  </section></div>;
}

export type EventDraft = { id?: string; noteId: string | null; title: string; description: string; startAt: number; endAt: number; timeZone: string; allDay: boolean };
export function EventDialog({ initial, onClose, onSaved }: { initial?: EventDraft; onClose: () => void; onSaved: () => void }) {
  const zoneDefault = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const base = initial ?? { noteId: null, title: '', description: '', startAt: Date.now() + 3600000, endAt: Date.now() + 7200000, timeZone: zoneDefault, allDay: false };
  const [draft, setDraft] = useState(base);
  const [start, setStart] = useState(initial ? localDateTimeInZone(initial.startAt, initial.timeZone) : localDateTimeInZone(base.startAt, zoneDefault));
  const [end, setEnd] = useState(initial ? localDateTimeInZone(initial.endAt, initial.timeZone) : localDateTimeInZone(base.endAt, zoneDefault));
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const root = useDialogFocus(true, () => { if (!saving) onClose(); });
  const zoneChanged = (z: string) => { try { if (start) setStart(localDateTimeInZone(zonedLocalToEpoch(start, draft.timeZone), z)); if (end) setEnd(localDateTimeInZone(zonedLocalToEpoch(end, draft.timeZone), z)); } catch {} setDraft({ ...draft, timeZone: z }); };
  const save = async () => {
    if (saving) return;
    setError('');
    if (!draft.title.trim()) { setError('Informe um título.'); return; }
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
  return <div className="overlay dialog-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose(); }}><section ref={root} className="modal agenda-dialog event-dialog" role="dialog" aria-modal="true" aria-labelledby="event-dialog-title">
    <header className="dlg-head"><h3 id="event-dialog-title">{draft.id ? 'Editar evento' : 'Novo evento'}</h3><p>Escolha o período e, se precisar, vincule uma nota.</p></header>
    <div className="dlg-field"><label htmlFor="event-title">Título</label><input id="event-title" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}/></div>
    <div className="dlg-field"><label htmlFor="event-description">Descrição</label><textarea id="event-description" value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })}/></div>
    <label><input type="checkbox" checked={draft.allDay} onChange={e => setDraft({ ...draft, allDay: e.target.checked })}/> Dia inteiro</label>
    <div className="dlg-grid"><div className="dlg-field"><label htmlFor="event-start">Início</label><input id="event-start" type={dateType} value={draft.allDay ? start.slice(0, 10) : start} onChange={e => setStart(e.target.value)}/></div><div className="dlg-field"><label htmlFor="event-end">Fim</label><input id="event-end" type={dateType} value={draft.allDay ? end.slice(0, 10) : end} onChange={e => setEnd(e.target.value)}/></div></div>
    <div className="dlg-field"><label htmlFor="event-zone">Fuso horário IANA</label><input id="event-zone" value={draft.timeZone} onChange={e => zoneChanged(e.target.value)}/></div>
    <NotePicker value={draft.noteId ? { id: draft.noteId, title: '' } : null} onChange={note => setDraft({ ...draft, noteId: note?.id ?? null })} optional/>
    {error && <p role="alert" className="dlg-error">{error}</p>}
    <div className="row"><button disabled={saving} onClick={onClose}>Cancelar</button><button className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Salvando…' : 'Salvar evento'}</button></div>
  </section></div>;
}
