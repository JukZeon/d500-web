import { useEffect, useState } from 'react';
import { CTCSS, DCS_CODES, encodeTone } from '../lib/tone';

export function toneParts(value: string) {
  if (!value) return { mode: 'off', code: '', polarity: 'N' };
  const dcs = /^D(.*?)([NI])$/i.exec(value);
  if (dcs) return { mode: 'dcs', code: dcs[1], polarity: dcs[2].toUpperCase() };
  if (/^RAW:/i.test(value)) return { mode: 'raw', code: value, polarity: 'N' };
  return { mode: 'ctcss', code: value, polarity: 'N' };
}
export default function ToneEditor({ value, onChange, label, compact = false }: { value: string; onChange: (value: string) => void; label: string; compact?: boolean }) {
  const { mode, code, polarity } = toneParts(value);
  const [manual, setManual] = useState(false), [error, setError] = useState('');
  const [draft, setDraft] = useState(code);
  useEffect(() => { setDraft(code); setError(''); }, [code]);
  const options = mode === 'dcs' ? DCS_CODES : CTCSS;
  const custom = manual || !options.includes(code);
  const setCode = (s: string) => {
    const next = mode === 'dcs' ? `D${s.replace(/^D/i, '').replace(/[NI]$/i, '')}${polarity}` : s;
    try { encodeTone(next); setError(''); onChange(next); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return <div className={`tone-editor ${compact ? 'compact' : ''}`} role="group" aria-label={label}>
    <select aria-label={`${label}类型`} value={mode} onChange={e => {
      setManual(false); setError('');
      onChange(e.target.value === 'off' ? '' : e.target.value === 'dcs' ? 'D023N' : '88.5');
    }}>
      <option value="off">关闭</option><option value="ctcss">{compact ? 'CTCSS' : '模拟 CTCSS'}</option><option value="dcs">{compact ? 'DCS' : '数字 DCS'}</option>{mode === 'raw' && <option value="raw">原始值</option>}
    </select>
    {(mode === 'ctcss' || mode === 'dcs') && <>
      <select className="tone-preset" aria-label={`${label}预设`} value={custom ? 'custom' : code} onChange={e => {
        if (e.target.value === 'custom') { setDraft(code); setManual(true); } else { setManual(false); setCode(e.target.value); }
      }}>
        {options.map(t => <option key={t} value={t}>{t}{mode === 'ctcss' ? ' Hz' : ''}</option>)}<option value="custom">手动填写…</option>
      </select>
      {custom && <input className="tone-custom mono" aria-label={`${label}手动值`} value={draft} inputMode={mode === 'ctcss' ? 'decimal' : 'numeric'} placeholder={mode === 'dcs' ? '023' : '88.5'} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} onBlur={() => {
        if (!draft.trim()) onChange('');
        else if (mode === 'dcs' && /^\d{1,3}$/.test(draft)) setCode(draft.padStart(3, '0'));
        else if (mode === 'ctcss' && /^\d{2,3}(?:\.\d)?$/.test(draft)) setCode(Number(draft).toFixed(1));
        else setCode(draft);
      }} />}
      {mode === 'dcs' && <select className="tone-polarity" aria-label={`${label}极性`} value={polarity} onChange={e => onChange(`D${code}${e.target.value}`)}><option value="N">{compact ? 'N' : '正码 N'}</option><option value="I">{compact ? 'I' : '反码 I'}</option></select>}
    </>}
    {error && <span className="tone-error" role="alert">{error}</span>}
    {mode === 'raw' && <span className="raw-tone mono" title="未识别的原始码值，保持原样；可切换类型重新设置">{value}</span>}
  </div>;
}
