// THE INTAKE QUESTIONNAIRE, in the client's hands: one section at a time, plain words, saved on
// every change, in the client's language. No form codes, no criteria keys: the client answers
// about their life; the firm's forms fill themselves on the other side.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IntakeQuestion, IntakeSection } from '@gadgets/workshop-shared/legal'
import { INTAKE_LANGS, tr, type IntakeLang } from './intake-i18n'

type Completion = { done: number; total: number; sectionsLeft: string[]; complete: boolean }
type Payload = { sections: IntakeSection[]; answers: Record<string, string>; completion: Completion }

const SAVE_DEBOUNCE_MS = 700
const LANG_KEY = 'legal-os:portal-lang'

function applies(q: IntakeQuestion, answers: Record<string, string>): boolean {
  return !q.showWhen || (answers[q.showWhen.key] ?? '') === q.showWhen.equals
}

function readLang(): IntakeLang {
  try {
    const v = window.localStorage.getItem(LANG_KEY)
    if (v && INTAKE_LANGS.some((l) => l.code === v)) return v as IntakeLang
  } catch { /* private mode */ }
  return 'en'
}

export function IntakeForm({ apiBase, onProgress }: { apiBase: string; onProgress: (c: Completion) => void }) {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [failed, setFailed] = useState(false)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [step, setStep] = useState(0)
  const [lang, setLang] = useState<IntakeLang>(() => readLang())
  const [save, setSave] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const pending = useRef<Record<string, string>>({})
  const timer = useRef<number | null>(null)
  const t = useCallback((key: string, fallback: string) => tr(lang, key, fallback), [lang])

  useEffect(() => {
    let cancelled = false
    fetch(`${apiBase}/intake`, { headers: { accept: 'application/json' } })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as Payload
        if (cancelled) return
        setPayload(data)
        setAnswers(data.answers)
        // Land on the first section with something still to answer.
        const first = data.sections.findIndex((s) => s.questions.some((q) => q.required && applies(q, data.answers) && !(data.answers[q.key] ?? '').trim()))
        setStep(first < 0 ? 0 : first)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [apiBase])

  const flush = useCallback(async () => {
    const batch = pending.current
    pending.current = {}
    if (Object.keys(batch).length === 0) return
    setSave('saving')
    try {
      const res = await fetch(`${apiBase}/intake`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answers: batch }) })
      if (!res.ok) throw new Error(String(res.status))
      const { completion } = (await res.json()) as { completion: Completion }
      setPayload((p) => (p ? { ...p, completion } : p))
      onProgress(completion)
      setSave('saved')
    } catch {
      // Keep the unsaved answers queued; the next change retries them together.
      pending.current = { ...batch, ...pending.current }
      setSave('failed')
    }
  }, [apiBase, onProgress])

  const change = useCallback((key: string, value: string) => {
    setAnswers((a) => ({ ...a, [key]: value }))
    pending.current[key] = value
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { void flush() }, SAVE_DEBOUNCE_MS)
  }, [flush])

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  const chooseLang = (code: IntakeLang) => {
    setLang(code)
    try { window.localStorage.setItem(LANG_KEY, code) } catch { /* private mode */ }
  }

  const sections = payload?.sections ?? []
  const section = sections[step]
  const completion = payload?.completion
  const sectionDone = useMemo(() => sections.map((s) => s.questions.every((q) => !q.required || !applies(q, answers) || (answers[q.key] ?? '').trim() !== '')), [sections, answers])

  if (failed) {
    return <p className="text-[14px] text-kumo-subtle">{t('ui:save_failed', "Couldn't load the questionnaire just now. Nothing was lost; it retries when you reload.")}</p>
  }
  if (!payload || !section) return <div className="h-40 rounded-[14px] bg-kumo-tint" />

  return (
    <div className="rounded-[14px] border border-kumo-line bg-kumo-elevated">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-kumo-line px-5 py-4">
        <div className="min-w-0">
          <p className="m-0 text-[15px] font-medium text-kumo-default">{t('ui:heading', 'About you')}</p>
          <p className="m-0 mt-1 max-w-[56ch] text-[13.5px] leading-[1.55] text-kumo-subtle">
            {t('ui:lead', 'Your legal team uses these answers to fill in the government forms. Answer what you can; your answers save as you type.')}
          </p>
        </div>
        <label className="text-[12px] text-kumo-subtle">
          {t('ui:language', 'Language')}
          <select
            value={lang}
            onChange={(e) => chooseLang(e.target.value as IntakeLang)}
            className="ml-2 rounded-md border border-kumo-line bg-kumo-base px-2 py-1 text-[13px] text-kumo-default"
          >
            {INTAKE_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>
      </div>

      {/* The map of sections: done ones carry a mark, the open one is ink. */}
      <ol className="flex flex-wrap gap-x-4 gap-y-1 border-b border-kumo-line px-5 py-3">
        {sections.map((s, i) => (
          <li key={s.key}>
            <button
              type="button"
              onClick={() => setStep(i)}
              className={`text-[12.5px] ${i === step ? 'font-medium text-kumo-default' : sectionDone[i] ? 'text-emerald-700' : 'text-kumo-subtle'}`}
            >
              {sectionDone[i] && i !== step ? '✓ ' : ''}{t(`section:${s.key}`, s.title)}
            </button>
          </li>
        ))}
      </ol>

      <div className="px-5 py-5">
        <h3 className="m-0 text-[17px] font-medium text-kumo-default">{t(`section:${section.key}`, section.title)}</h3>
        <p className="m-0 mt-1 text-[13.5px] leading-[1.55] text-kumo-subtle">{t(`intro:${section.key}`, section.intro)}</p>
        <div className="mt-5 space-y-5">
          {section.questions.filter((q) => applies(q, answers)).map((q) => (
            <Question key={q.key} q={q} value={answers[q.key] ?? ''} onChange={(v) => change(q.key, v)} t={t} />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-kumo-line px-5 py-3">
        <span className="tnum text-[12.5px] text-kumo-subtle">
          {completion && t('ui:progress', '{done} of {total} required answers').replace('{done}', String(completion.done)).replace('{total}', String(completion.total))}
          {save === 'saving' && ` · ${t('ui:saving', 'Saving…')}`}
          {save === 'saved' && ` · ${t('ui:saved', 'Saved')}`}
        </span>
        <div className="flex gap-2">
          <button type="button" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))} className="rounded-full border border-kumo-line px-4 py-1.5 text-[13.5px] text-kumo-default disabled:opacity-30">
            {t('ui:back', 'Back')}
          </button>
          <button type="button" disabled={step >= sections.length - 1} onClick={() => setStep((s) => Math.min(sections.length - 1, s + 1))} className="rounded-full bg-kumo-brand px-4 py-1.5 text-[13.5px] font-medium text-white disabled:opacity-30">
            {t('ui:next', 'Next')}
          </button>
        </div>
      </div>
      {save === 'failed' && <p className="m-0 border-t border-kumo-line px-5 py-2 text-[12.5px] text-amber-700">{t('ui:save_failed', "Couldn't save. Your answers are kept here; we'll try again.")}</p>}
      {completion?.complete && <p className="m-0 border-t border-kumo-line px-5 py-3 text-[13.5px] text-emerald-700">{t('ui:complete', 'Thank you. Your questionnaire is complete; your legal team has it.')}</p>}
    </div>
  )
}

function Question({ q, value, onChange, t }: { q: IntakeQuestion; value: string; onChange: (v: string) => void; t: (k: string, f: string) => string }) {
  const label = t(`q:${q.key}`, q.label)
  const field = 'w-full rounded-[10px] border border-kumo-line bg-kumo-base px-3 py-2 text-[14.5px] text-kumo-default outline-none focus:border-kumo-ring'
  return (
    <label className="block">
      <span className="text-[13.5px] font-medium text-kumo-default">
        {label}{q.required && <span className="ml-1.5 text-[11px] font-normal text-kumo-subtle">{t('ui:required', 'required')}</span>}
      </span>
      {q.help && <span className="mt-0.5 block text-[12.5px] leading-[1.5] text-kumo-subtle">{q.help}</span>}
      <span className="mt-1.5 block">
        {q.type === 'textarea' ? (
          <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className={`${field} resize-y`} />
        ) : q.type === 'date' ? (
          <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={field} />
        ) : q.type === 'yesno' ? (
          <span className="flex gap-2">
            {(['yes', 'no'] as const).map((v) => (
              <button key={v} type="button" onClick={() => onChange(v)} className={`rounded-full border px-4 py-1.5 text-[13.5px] ${value === v ? 'border-kumo-brand bg-kumo-brand text-white' : 'border-kumo-line text-kumo-default'}`}>
                {t(`ui:${v}`, v === 'yes' ? 'Yes' : 'No')}
              </button>
            ))}
          </span>
        ) : q.type === 'select' ? (
          <select value={value} onChange={(e) => onChange(e.target.value)} className={field}>
            <option value="">{t('ui:choose', 'Choose…')}</option>
            {(q.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input type="text" value={value} onChange={(e) => onChange(e.target.value)} autoComplete={q.type === 'country' ? 'country-name' : 'off'} className={field} />
        )}
      </span>
    </label>
  )
}
