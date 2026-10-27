import { useState } from 'react';
import { RotateCcw, Settings2 } from 'lucide-react';
import type { DatTemplate, RadioSettings } from '../lib/model';
import { MENU_SETTINGS, VFO_SETTINGS, readSettings, settingsChanges, type SettingDefinition } from '../lib/settings';

function SettingSelect({ definition: d, value, before, onChange }: { definition: SettingDefinition; value: number; before: number; onChange: (value: number) => void }) {
  return <label className={`device-field ${value !== before ? 'modified' : ''}`}><span>{d.label}{value !== before && <i title="已修改" />}</span><select aria-label={d.label} value={value} onChange={e => onChange(Number(e.target.value))}>
    {d.options.map((label, i) => <option key={i} value={i}>{label}</option>)}{!d.options[value] && <option value={value}>保留原值 · {value}</option>}
  </select></label>;
}
export default function RadioSettingsPanel({ template, settings, onChange, onImport }: { template: DatTemplate | null; settings?: RadioSettings; onChange: (settings: RadioSettings) => void; onImport: () => void }) {
  const [tab, setTab] = useState('general');
  if (!template) return <section className="device-panel"><div className="empty-state"><Settings2 size={34} /><h3>导入 DAT 后编辑电台设置</h3><p>载入旧版 D500 原厂导出文件。</p><button className="btn primary" onClick={onImport}>导入 DAT</button></div></section>;
  const baseline = readSettings(template.rows), values = settings ?? baseline;
  const changeCount = settingsChanges(values, baseline);
  const groups = [...new Set(MENU_SETTINGS.map(d => d.group))];
  return <section className="device-panel">
    <div className="panel-head"><div><h2>电台设置 <span className="tag">D500 V1</span></h2><p>{template.fileName} · {MENU_SETTINGS.length} 项整机设置 · 4 个频率区</p></div><button className="btn" disabled={!changeCount} onClick={() => onChange(baseline)}><RotateCcw size={14} />恢复模板设置</button></div>
    <div className="device-tabs" role="tablist" aria-label="电台设置分类">{[['general', '整机设置'], ['vfo', '频率模式 A / B / C / D'], ['data', 'DAT 数据范围']].map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}<span>{changeCount ? `${changeCount} 项已修改` : '与模板一致'}</span></div>
    {tab === 'general' && <div className="device-groups">{groups.map(group => <article className="device-card" key={group}><h3>{group}</h3><div className="device-fields">{MENU_SETTINGS.filter(d => d.group === group).map(d => <SettingSelect key={d.key} definition={d} value={values.menu[d.key]} before={baseline.menu[d.key]} onChange={value => onChange({ ...values, menu: { ...values.menu, [d.key]: value } })} />)}</div></article>)}</div>}
    {tab === 'vfo' && <div className="vfo-grid">{values.vfo.map((vfo, b) => {
      const digits = template.rows[240 + b * 2].slice(3, 11);
      const freq = digits.every(v => v <= 9) ? (Number(digits.join('')) / 100000).toFixed(5) : '原始值';
      return <article className="device-card" key={b}><h3><span className="vfo-letter">{'ABCD'[b]}</span><span className="mono">{freq} <small>MHz</small></span></h3><div className="device-fields">{VFO_SETTINGS.map(d => <SettingSelect key={d.key} definition={{ ...d, label: `${'ABCD'[b]} 区 ${d.label}` }} value={vfo[d.key]} before={baseline.vfo[b][d.key]} onChange={value => onChange({ ...values, vfo: values.vfo.map((v, i) => i === b ? { ...v, [d.key]: value } : v) })} />)}</div><p className="field-tip">频点、频差数值与哑音沿用模板。</p></article>;
    })}</div>}
    {tab === 'data' && <div className="data-scope"><h3>已确认的数据范围</h3><dl><dt>信道 000–199</dt><dd>收发频率、名称、CTCSS / DCS、功率、带宽、扫描、PTT-ID、繁忙禁发、信令与扰频。</dd><dt>整机菜单与频率模式</dt><dd>本页可编辑字段已对照官方 V1 写频软件的保存逻辑。</dd><dt>其他数据</dt><dd>信令码组内容、FM 广播、开机文字、密码、校准及未确认区域按原始 DAT 保留。</dd></dl><p>导出后仍通过原厂 V1 软件写入电台；尚未进行实机写入验证。</p><a href="https://github.com/JukZeon/d500-web/blob/main/docs/DAT_FORMAT.md" target="_blank" rel="noreferrer">查看格式研究与验证记录 ↗</a></div>}
    <div className="device-footnote">修改随方案自动保存，并写入导出的 DAT。数值型延迟项目沿用原厂软件的档位标号。</div>
  </section>;
}
