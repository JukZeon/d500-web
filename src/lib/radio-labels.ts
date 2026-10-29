import translations from './radio-settings-zh.json';
const labels:Record<string,string>=translations;
const descriptions:[string,string][]=[
 ['Sets how strong a received signal must be','设定静噪门限。0 级保持开启；数值越高，越能抑制弱信号和噪声。'],
 ['Cuts standby power consumption','无信号时周期性关闭接收以节电，可能漏掉通话开头。'],
 ['Limits how long a single transmission','限制每次连续发射时间，到时停止发射；松开发射键后可重新发射。关闭表示不限时。'],
 ['Warns you the selected number of seconds','在发射限时结束前提前提示；关闭则不预警。'],
 ['Sounds a short confirmation tone','操作时播放按键提示音。'],
 ['Sets the VOX sensitivity','设定声控灵敏度。过高容易受环境噪声触发，过低可能无法识别人声。'],
 ['How long the transmitter stays keyed','停止说话后继续保持发射的时间，避免短暂停顿中断通话。'],
 ['Announces the channel number','操作时播报信道号等信息。'],
 ['Periodically checks both the A and B','交替检查 A、B 区频率；收到信号时停留在该区，直到信号消失。'],
 ['Controls what scanning does','定时模式经过预设时间继续扫描；载波模式在信号消失后继续；搜索模式收到信号后停止。'],
 ['Chooses which transmitted DTMF tones','选择本机扬声器是否播放手动按键音、自动身份码音或两者。'],
 ['Sets how many seconds the display backlight','操作或收发后保持背光的时间；0 关闭自动背光，“常亮”保持点亮。'],
 ['Selects the display backlight color used while receiving','选择接收时的背光颜色，也可关闭。'],
 ['Selects the display backlight color used while transmitting','选择发射时的背光颜色，也可关闭。'],
 ['Selects the display backlight color while the radio is in standby','选择待机时的背光颜色，也可关闭。'],
 ['Automatically locks the keypad','自动锁定键盘，防止误操作；仍可通过设备按键手动解锁。'],
 ['Controls when the ANI code is sent','选择在按下发射键、松开发射键、两者或均不发送身份码。'],
 ['Controls when this channel sends','选择本信道在按下或松开发射键时发送身份码。'],
 ['Enables or disables the alarm sound','控制本机扬声器是否播放报警声音。'],
 ['Chooses how the alarm function operates','选择长按呼叫键时执行本机报警、音调报警或编码报警。'],
 ['Chooses what the emergency alarm does','本机报警仅本机发声；音调报警发射重复报警音；编码报警发送 119 及本机身份码。'],
 ['Controls access to the full front-panel menu','允许或禁止通过电台菜单修改设置。'],
 ['Controls whether the radio\'s front-panel RESET','控制电台是否显示复位菜单；修改此开关不会立即复位设备。'],
 ['Selects which side has transmit priority','设定双守候时优先使用的发射工作区。'],
 ['Transmits a special end-of-transmission signal','发送消尾信号以减少兼容设备的通话结束噪声；过中继时按设备要求设置。'],
 ['Selects the squelch-tail elimination setting','设定过中继的尾音消除参数；中继不支持时关闭或选 0 毫秒。'],
 ['Sets the delay before repeater squelch-tail elimination','设定中继尾音消除前的延时；不需要时关闭或选 0 毫秒。'],
 ['Prevents transmitting on a channel','信道已有信号时禁止发射；按下发射键时以提示音提醒。'],
 ['Selects the language of the menus','选择菜单及语音提示使用的语言。'],
 ['Chooses where a CTCSS or DCS code found','将频率模式搜索到的哑音保存为收发哑音、仅接收哑音或仅发射哑音。'],
 ['Allows or blocks use of the 65-108 MHz','控制是否允许使用呼叫键打开 65–108 MHz 调频收音机。'],
 ['Blocks use of the broadcast FM radio receiver','禁止使用调频收音机；关闭此开关后可正常使用。'],
 ['Enables transmission in the configured UHF range.','允许 UHF 频段发射；关闭后该频段仅可接收。'],
 ['Enables transmission in the configured VHF range.','允许 VHF 频段发射；关闭后该频段仅可接收。'],
 ['Sets how long the menu stays open','无按键操作后自动退出菜单的等待时间。'],
 ['Sends a short tone at the end','每次发射结束时发送提示音，通知对方已松开发射键。'],
 ['Chooses the startup display: Full','选择开机全屏测试，或显示自定义的两行开机文字。'],
 ['Chooses the startup display,','选择开机显示标志、电池电压等内容。'],
 ['First line of the custom startup text','开机显示选择“自定义文字”时显示的第 1 行。'],
 ['Second line of the custom startup text','开机显示选择“自定义文字”时显示的第 2 行。'],
 ['Read-only alternate startup text','设备保存的备用开机文字，只读。'],
 ['Read-only firmware identification','设备保存的固件标识，只读。'],
 ['Programs the radio\'s numeric Automatic Number','设置本机 ANI 身份码，通过 DTMF 发送给兼容设备。'],
 ['Programs the three-character DTMF code','设置编码报警时发送的 3 位 DTMF 码。'],
 ['Delays transmission of the automatic ANI/PTT-ID','按下发射键后等待指定时间，再发送自动身份码。'],
 ['Sets how long each DTMF tone','每个 DTMF 码音的持续时间；解码不稳定时可适当延长。'],
 ['Sets the silent gap between transmitted DTMF tones','相邻 DTMF 码音的间隔；对方无法区分码音时可适当延长。'],
 ['Sets how long the DTMF decoder remains active','收到有效码后，DTMF 解码器保持激活的时间。'],
 ['Sets the current keypad-lock state. Hold the #','设定当前键盘锁状态，长按井号键切换锁定或解锁。'],
 ['Sets the current keypad-lock state. Hold the *','设定当前键盘锁状态，长按星号键切换锁定或解锁。'],
 ['Selects the operating mode used at startup','选择开机进入可直接调频的频率模式，或已保存的信道模式。'],
 ['Selects whether display line A or B','选择用于调频及前面板操作的当前工作区。'],
 ['Service override for supported-frequency checks','覆盖上传时的频段检查。通常保持默认；此项不会改变硬件能力。'],
 ['The profile ','容量配置仅为推测，以电台实际返回值为准；导入镜像后自动确定容量。0x40000 及以上的引导区域不允许访问。']
];
/** Display strings only: option values, setting keys and user-entered text stay unchanged. */
export function radioLabel(value:string|number):string {
 const text=String(value).trim();
 if(labels[text])return labels[text];
 if(text==='All channels')return '全部信道';
 if(text==='Menu Quit Timer')return '菜单退出时间';
 if(text==='Save Mode')return '省电模式';
 if(text==='Displays DTMF codes received in the middle of the screen (D Live)')return '在屏幕中央显示收到的 DTMF 编码';
 let match:RegExpMatchArray|null;
 if((match=text.match(/^([\d.]+)\s*(ms|s|sec|min|mAh)$/)))return `${match[1]} ${{ms:'毫秒',s:'秒',sec:'秒',min:'分钟',mAh:'毫安时'}[match[2]]}`;
 if((match=text.match(/^0x([0-9a-f]+) \((\d+) KiB\)$/i)))return `容量 ${match[2]} KiB（0x${match[1]}）`;
 if((match=text.match(/^(?:Ch|Channel M)(\d+)$|^Ch (\d+)$/)))return `信道 ${match[1]??match[2]}`;
 if((match=text.match(/^FM_(\d+)$/)))return `收音机预设 ${match[1]}`;
 if((match=text.match(/^Band (F?\d+)$/)))return `频段 ${match[1]}`;
 if((match=text.match(/^Frequency Band (\d+-\d+)$/)))return `频段 ${match[1]}`;
 if((match=text.match(/^Level (\d+)(?: (Off|On))?$/)))return `等级 ${match[1]}${match[2]?` · ${radioLabel(match[2])}`:''}`;
 if(text==='Level 3 (voltage calibration)')return '等级 3（电压校准）';
 if((match=text.match(/^Squelch (\d+)$/)))return `静噪 ${match[1]}`;
 if((match=text.match(/^List (\d+)$/)))return `扫描列表 ${match[1]}`;
 if((match=text.match(/^(?:Scanlist|List) (\d+) priority channel(?: (scan)|( \d+)(?: \(0 - off\))?)$/)))return `扫描列表 ${match[1]} ${match[2]?'优先信道扫描':`优先信道${match[3]}${text.endsWith('(0 - off)')?'（0 关闭）':''}`}`;
 if((match=text.match(/^DTMF Contact (\d+) (name|number)$/)))return `DTMF 联系人 ${match[1]} ${match[2]==='name'?'名称':'号码'}`;
 if((match=text.match(/^(PTT ID Code|Signal Code) (\d+)( Name)?$/)))return `${match[1]==='PTT ID Code'?'发射身份码':'信令码组'} ${match[2]}${match[3]?'名称':''}`;
 if(text==='PTT ID Code')return '发射身份码';
 if((match=text.match(/^VFO ([AB]) (Bandwidth|Frequency|Offset \(0.0-999.999\)|PTT-ID|Power|Shift|Tuning Step)$/)))return `${match[1]} 区${{Bandwidth:'带宽',Frequency:'频率','Offset (0.0-999.999)':'频差（MHz）','PTT-ID':'发射身份码',Power:'发射功率',Shift:'频差方向','Tuning Step':'频率步进'}[match[2]]}`;
 if((match=text.match(/^(.*) \(([A-Za-z0-9 ]+)\)$/))&&labels[match[1]])return `${labels[match[1]]}（${match[2]}）`;
 if((match=text.match(/^Programs DTMF code (\d+)\./)))return `设置 DTMF 编码 ${match[1]}；信道或频率模式可选择此码作为发射身份码。`;
 if((match=text.match(/^Sets the call name for DTMF code (\d+),/)))return `DTMF 编码 ${match[1]} 的呼叫名称，最多 10 个字符。`;
 if((match=text.match(/^In channel mode, chooses whether display line ([AB])/)))return `选择信道模式下 ${match[1]} 区显示编号、名称或频率。`;
 if((match=text.match(/^Selects (?:Frequency \(VFO\) mode.*display|the memory channel shown on display line) ([AB])/)))return `选择 ${match[1]} 区的频率／信道工作模式或当前信道。`;
 if((match=text.match(/^Selects VFO ([AB])'s transmitter power/)))return `选择 ${match[1]} 区发射功率。`;
 if((match=text.match(/^Selects wide or narrow FM for VFO ([AB])/)))return `选择 ${match[1]} 区宽带或窄带调频，按所用信道的带宽设置。`;
 if((match=text.match(/^Sets VFO ([AB])'s repeater shift direction/)))return `设置 ${match[1]} 区频差方向：正频差向上偏移，负频差向下偏移，关闭则收发同频。`;
 if((match=text.match(/^Sets how far VFO ([AB]) moves/)))return `设置 ${match[1]} 区调频与扫描时的频率步进。`;
 if((match=text.match(/^Sets the difference in MHz between VFO ([AB])/)))return `设置 ${match[1]} 区收发频差，单位 MHz；由频差方向决定加减。`;
 if((match=text.match(/^Sets the receive frequency shown on display line ([AB])/)))return `设置 ${match[1]} 区频率模式的接收频率。`;
 if((match=text.match(/^Selects which of the 15 programmed DTMF PTT-ID codes (VFO [AB]|this channel)/)))return `选择${match[1]==='this channel'?'本信道':`${match[1].slice(-1)} 区`}使用的 DTMF 身份码；码组内容在 DTMF 设置中编辑。`;
 if((match=text.match(/^Sets the radio's (lower|upper) (UHF|VHF) transmit limit/)))return `设置 ${match[2]} 发射${match[1]==='lower'?'下':'上'}限，单位 MHz。`;
 for(const [prefix,translated]of descriptions)if(text.startsWith(prefix))return translated;
 return text;
}
