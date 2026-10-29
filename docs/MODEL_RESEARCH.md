# 按型号核对的项目与实现

核对日期：2026-10-29；对应版本：0.6.0-beta.2。

除固定的 CHIRP 驱动外，逐项阅读了下列项目的编解码、串口或固件实现。项目名称相近不代表镜像可以互刷；这里记录能交叉核对的事实、差异及本项目采取的处理。第三方实现中的缺项也不作为设备能力限制。

## D500 旧版

- [K1toD500](https://github.com/Liuli-Lumine/K1toD500/tree/e65cbb309986f0f37babaae7fac77f9fd21b5ab1) 提供 DAT 与表格转换实现，但其说明指向新版 CPS，不能单独证明旧版串口兼容。
- 本项目另外核对了官方 V1 CPS、说明书、真实 DAT 和读写抓包；来源与哈希见 [研究记录](../research/D500_RESEARCH.md) 和 [sources.json](../research/sources.json)。串口实现以实机记录为准。
- 当前仍为 200 信道、16 字节 GBK 名称存储；屏幕已实测完整显示 6 个汉字或 8 个英数字。支持已验证的增量块写入，不能把这套策略移植给宝锋或泉盛。

## UV-5R 经典版

- 阅读 [SAPSAN Radio Programmer 的信道布局](https://github.com/SAPSAN-CYBERSEC/sapsan-radio-programmer/blob/f3236b0e8dd69aa2bfeed9948497af3a36ec9f61/src/radio/uv5r-memory.ts)、同提交的 `uv5r-protocol.ts`、`web-serial.ts`，另核对 [uv5r_programmer_python](https://github.com/JSHowland2025/uv5r_programmer_python/tree/e32e7c5ded4f384f63a39a53d44994999fe123f6) 的单信道读写实现。
- 128 条信道、16 字节记录；名称在独立的 `0x1000` 表中，每项跨度 16 字节、有效名称 7 位。经典版宽带位为 1 表示 FM，与 UV-17Pro 家族相反。
- SAPSAN 当前代码把 DCS 当作未支持的哑音处理，不能整段替代现有编解码。本项目继续提供独立 CTCSS / DCS 与极性；经典版名称使用其允许的英文字符，不套用 UV-5RH 中文规则。
- 参考镜像、软件往返及浏览器串口适配已验证；本轮没有这台机器的实机测试。

## UV-5RH 普通版

- 阅读 [Codeplug Studio 的 UV-5R Mini 协议研究](https://github.com/pskillen/codeplug-studio/blob/5a5ae9134df207740ec046eecb5ba8209cf80776/docs/reference/radios/baofeng/uv-5r-mini/protocol.md) 和 [32 字节记录布局](https://github.com/pskillen/codeplug-studio/blob/5a5ae9134df207740ec046eecb5ba8209cf80776/docs/reference/radios/baofeng/uv-5r-mini/channel-record.md)，核对同属 UV-17Pro 家族的字段与连续写频会话问题。Mini 的识别字符串、容量和握手差异不直接用于普通 UV-5RH。
- 继续追到其实际共用的 [protocol.ts](https://github.com/pskillen/codeplug-studio/blob/5a5ae9134df207740ec046eecb5ba8209cf80776/src/integrations/radio-io/radios/uv17pro-family/protocol.ts) 和 [channelCodec.ts](https://github.com/pskillen/codeplug-studio/blob/5a5ae9134df207740ec046eecb5ba8209cf80776/src/integrations/radio-io/radios/uv17pro-family/channelCodec.ts)：协议保存已进入写频状态，避免重复握手；名称读取按单字节字符、写入使用 UTF-8，不能直接用于这台中文机器。本项目根据实机字节独立实现 GBK 适配。
- 同时检查 [UV-5RM / 5RH 硬件逆向](https://github.com/amoxu/Baofeng-UV-5RM-5RH-RE/tree/cc03870e0e29d9ded34a55d907d00167e8e0bb6f)。存在不同射频芯片和衍生硬件，不能仅靠外壳型号推断兼容。未刷入第三方固件。
- 实际连接一台支持中文的普通 UV-5RH，115200 8N1；完整读取 33,664 字节、134 条有效信道。原始名称字段是 **12 字节 GBK**，不是上游单字节字符串；可存 6 个汉字或 12 个英数字，中英混排共用字节额度。此处是存储与读写结论，未单独验证屏幕宽度。
- 新适配器实现 GBK 编解码、超长拒绝、已有记录的未修改字节保留。原始 134 条信道逐条解码再编码，整份镜像零差异。
- 抓包确认刚结束的写频会话可能仍在运行，重复识别返回 `R`。现在清理残留帧，并用带地址的读取帧确认既有会话；逐块核对返回地址、长度及写入 ACK。不会重复发送失败的写入帧，也不增加整机写前读取或写后自动回读。
- 临时在空信道 1000 写入“中文名称测试”，真实读回名称字节一致。随后完整写回测试前镜像，526 块全部确认；独立读取确认全镜像零差异、134 条信道恢复、测试位置为空。Chrome 网页再次实际读取，同原镜像一致。
- 单独写入全 FF 块虽然收到 ACK，却未清空测试记录；完整上传可以恢复。因此本型号仍使用完整配置上传，不开放未经证明的硬件增量写入。

实测脱敏摘要：[uv5rh-hardware.json](audit/uv5rh-hardware.json)。原始 IMG、串口记录及个人信道表不公开。物理断电后的持久化未单独测试。

## UV-K5 / K6 原厂与 Egzumer

- 核对 [Egzumer uvtools](https://github.com/egzumer/uvtools/tree/7148b01f11357cb28e74fff3a9591b12a656ea13) 的 `js/qsSerial.js`、`tool_configurator.js`，以及 [k5prog](https://github.com/sq5bpf/k5prog/tree/241ab18b61f6d8933fecf60643fe94322fbf4198) 的 EEPROM 操作与复位实现。
- 独立网页实现确认 K5 的帧封装、CRC、异或与 EEPROM 指令；k5prog 区分原厂稀疏写入顺序和校准区之前的连续写入。不能把“整份备份”理解为全部区域都应该回写。
- 本项目按原厂与 Egzumer 分别识别固件、提供各自设置和合法参数；保持现有驱动规定的上传区域，不写校准区。两种参考镜像和 WASM 往返已验证，本轮未做这两种固件的实机验收。

## UV-K5 / K6 LOSEHU 扩容版

- 阅读 [K5Web 串口与中文实现](https://github.com/silenty4ng/k5web/blob/55f49866078a35e3d1d740f89be5056845bec6e4/src/utils/serial.js)、同提交的设置与 EEPROM 备份页面，并核对 [LOSEHU 固件设置源码](https://github.com/losehu/uv-k5-firmware-custom/tree/49222a9f431a006dfaaaa665b839e4953b1a1882)。
- K5Web 分开处理早期 LOSEHU 专用字库映射与 GB2312，扩容寻址也有独立命令。2 Mbit 只表示容量，不能据此猜测中文编码或菜单布局。
- 现有内置适配器对应已识别的 GB2312 分支；本轮将可用名称限制补为 **13 字节**，避免上游按字节截断时把“13 个字符”误当成可写长度。信道记录中的名称区域与完整 EEPROM 的字库区域分别处理。
- 256 KiB 参考镜像导入、编辑、导出保持高地址数据；正常上传仅到 `0x1cff`，不上传字库、引导和校准。基本设置仅开放已核对的 131HS / 132 系列布局；未知版本不猜测配置地址。早期专用字库分支不在当前适配范围。
- 已完成参考镜像、设置掩码、名称字节额度及浏览器编辑验证；尚缺对应设备与准确固件版本的实机读写。

## 验证边界

独立项目用于交叉核对，不等于替它们作兼容背书；未整段引入许可不明的源码。内置驱动及第三方许可见 [THIRD_PARTY.md](../THIRD_PARTY.md)。当前实机结果只覆盖记录中的 D500 和普通 UV-5RH，不外推至其他型号或硬件批次。自动测试和浏览器验证见 [多型号验证记录](MULTIRADIO_VALIDATION.md)。

## 0.6.0-beta.5 补充：LOSEHU 多版本

此前“仅 GB2312 扩容版”的限制已由本项目适配器扩展。重新检查 K5Web 的导航版本匹配表、全部相关配置 JSON、实际信道页及串口编解码，并对照官方 117 / 131 / 132 / 133 源码。现支持标准指令、扩容指令及三种名称字库；官方 EK 的英文限制单独处理。具体矩阵及未覆盖的定制版本见 [LOSEHU_COMPATIBILITY.md](LOSEHU_COMPATIBILITY.md)。

本轮非扩容实机返回 `LOSEHU132`：读取 8 KiB、101 条信道、基本设置；导入导出及逐条重编码全镜像零字节变化，修复了上游航空频率自动变换。未发送 EEPROM 写入或重启命令。此实机结果不外推至早期 K、H / HS、LTS 或 D 分支。
