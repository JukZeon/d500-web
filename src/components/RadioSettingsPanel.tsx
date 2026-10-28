import { useState } from 'react';
import { RotateCcw, Settings2 } from 'lucide-react';
import type { DatTemplate, RadioSettings } from '../lib/model';
import { MENU_SETTINGS, VFO_SETTINGS, completeSettings, readSettings, settingsChanges, validateSettings, type SettingDefinition } from '../lib/settings';
import { decodeTone, encodeTone } from '../lib/tone';
import ToneEditor from './ToneEditor';

function SettingSelect({ definition: d, value, before, onChange }: { definition: SettingDefinition; value: number; before: number; onChange: (value: number) => void }) {
  return <label className={`device-field ${value !== before ? 'modified' : ''}`}><span>{d.label}{value !== before && <i title="已修改" />}</span><select aria-label={d.label} value={value} onChange={e => onChange(Number(e.target.value))}>
    {d.options.map((label, i) => <option key={i} value={i}>{label}</option>)}{!d.options[value] && <option value={value}>保留原值 · {value}</option>}
  </select></label>;
}
function DecimalField({ label, value, scale, max, onChange }: { label: string; value: number; scale: number; max: number; onChange: (value: number) => void }) {
  const formatted = value < 0 ? '' : (value / scale).toFixed(Math.log10(scale));
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && (!/^\d+(?:\.\d*)?$/.test(draft) || Number(draft) < (scale === 100000 ? 0.00001 : 0) || Number(draft) > max || (draft.split('.')[1]?.length ?? 0) > Math.log10(scale));
  return <label className="device-field"><span>{label} <small>MHz</small></span><input className="mono" aria-label={label} inputMode="decimal" value={draft ?? formatted} aria-invalid={invalid} placeholder="保留原值" onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft !== null && !invalid && draft.trim()) { onChange(Math.round(Number(draft) * scale)); setDraft(null); } }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setDraft(null); }} />{invalid && <small className="inline-error">最多 {Math.log10(scale)} 位小数，范围 0–{max} MHz</small>}</label>;
}
export default function RadioSettingsPanel({ template, settings, onChange, onImport }: { template: DatTemplate | null; settings?: RadioSettings; onChange: (settings: RadioSettings) => void; onImport: () => void }) {
  const [tab, setTab] = useState('general'), [extra, setExtra] = useState(false);
  if (!template) return <section className="device-panel"><div className="empty-state"><Settings2 size={30} /><h3>暂无配置</h3><button className="btn primary" onClick={onImport}>导入 DAT</button></div></section>;
  const baseline = readSettings(template.rows), values = completeSettings(settings, baseline);
  const changeCount = settingsChanges(values, baseline), groups = [...new Set(MENU_SETTINGS.map(d => d.group))];
  const updateVfo = (bank: number, key: string, value: number) => onChange({ ...values, vfo: values.vfo.map((v, i) => i === bank ? { ...v, [key]: value } : v) });
  return <section className="device-panel">
    <div className="panel-head"><div><h2>电台设置</h2><p>{template.fileName}</p></div><button className="btn" disabled={!changeCount} onClick={() => onChange(baseline)}><RotateCcw size={14} />恢复原值</button></div>
    <div className="device-tabs" role="tablist" aria-label="电台设置分类">{[['general', '整机'], ['vfo', '频率模式'], ['display', '开机显示']].map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}<span>{changeCount ? `${changeCount} 项修改` : '未修改'}</span></div>
    {tab === 'general' && <div className="device-groups">{groups.map(group => <article className="device-card" key={group}><h3>{group}</h3><div className="device-fields">{MENU_SETTINGS.filter(d => d.group === group).map(d => <SettingSelect key={d.key} definition={d} value={values.menu[d.key]} before={baseline.menu[d.key]} onChange={value => onChange({ ...values, menu: { ...values.menu, [d.key]: value } })} />)}</div></article>)}</div>}
    {tab === 'vfo' && <><div className="vfo-grid">{values.vfo.slice(0, extra ? 4 : 2).map((vfo, b) => <article className="device-card" key={b}><h3><span className="vfo-letter">{'ABCD'[b]}</span>{b < 2 ? '频率模式' : '备用频率区'}</h3><div className="device-fields"><DecimalField key={`${template.fileName}-${b}-frequency-${vfo.frequency}`} label={`${'ABCD'[b]} 区频率`} value={vfo.frequency} scale={100000} max={999.99999} onChange={value => updateVfo(b, 'frequency', value)} /><DecimalField key={`${template.fileName}-${b}-offset-${vfo.offset}`} label={`${'ABCD'[b]} 区频差`} value={vfo.offset} scale={1000} max={99.999} onChange={value => updateVfo(b, 'offset', value)} />{(['rxTone', 'txTone'] as const).map((key, i) => <div className="vfo-tone" key={key}><span>{i ? '发射哑音' : '接收哑音'}</span><ToneEditor label={`${'ABCD'[b]} 区${i ? '发射' : '接收'}哑音`} value={decodeTone(vfo[key])} onChange={value => updateVfo(b, key, encodeTone(value))} /></div>)}{VFO_SETTINGS.map(d => <SettingSelect key={d.key} definition={{ ...d, label: `${'ABCD'[b]} 区 ${d.label}` }} value={vfo[d.key]} before={baseline.vfo[b][d.key]} onChange={value => updateVfo(b, d.key, value)} />)}</div></article>)}</div><button className="text-btn extra-vfo" onClick={() => setExtra(!extra)}>{extra ? '收起 C / D' : '展开 C / D'}</button></>}
    {tab === 'display' && <div className="boot-editor"><h3>开机文字</h3><input aria-label="开机文字" value={values.text?.boot ?? ''} onChange={e => onChange({ ...values, text: { ...values.text, boot: e.target.value } })} /><p>限 15 个英文、数字或符号</p></div>}
    {validateSettings(values, baseline).map((message, i) => <p className="inline-error settings-error" role="alert" key={i}>{message}</p>)}
  </section>;
}
