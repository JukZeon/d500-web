# 内置电台驱动

CHIRP 驱动直接随网页发布，在浏览器 Worker 内运行，通过 Web Serial 访问写频线。使用者不需要安装 Python、CHIRP、本机服务或连接器；信道文件、镜像和串口数据不上传服务器。

## 架构

- `engine.py`：型号识别、IMG 元数据校验、收发频率和哑音转换、配置字段、编辑及镜像导出。
- `browser.py`：CHIRP 串口接口到浏览器消息的适配。保留 pyserial 的部分读取／超时语义。
- `worker.js`：固定的驱动入口，用内置 Pyodide 执行；只接受配置操作，不加载用户提供的 Python 脚本。
- `src/lib/chirp-runtime.ts`：Web Serial、异步接收、共享缓冲区和工作线程之间的同步。不使用 D500 的串口节奏。
- `losehu_profiles.py` / `losehu.py`：按实际版本自动选择普通／扩容指令、ASCII／早期字库／GB2312 名称、备份范围和已核对的基本设置。未改动上游驱动 ZIP。
- `uv5rh.py`：普通 UV-5RH 的 GBK 名称、未修改字节保留及连续写频会话适配，已按实机核对。

Web Serial 需要桌面 Chrome / Edge 和 HTTPS（本机可用 localhost）。Worker 共享缓冲区需要 `Cross-Origin-Opener-Policy: same-origin`、`Cross-Origin-Embedder-Policy: require-corp`。项目开发服务器和 Nginx 示例已包含这些响应头。

驱动及运行时全部由本站提供，首次解析 IMG 或操作新增型号时按需加载。D500 延续原来的浏览器协议实现，不加载此运行时。

## 兼容范围

| 型号／固件 | 信道 | 配置 | 验证 |
| --- | --- | --- | --- |
| 宝锋 UV-5R 原版 | 0–127，7 位名称 | CHIRP 驱动提供的设置及信道附加字段 | 上游参考镜像、软件验证；新增网页串口路径待实机 |
| 宝锋 UV-5RH 普通版 | 1–1000，12 字节 GBK 名称 | 对应驱动的设置及信道附加字段 | 实机中文写读、526 块完整恢复零字节差异、Chrome 网页实机读取 |
| 泉盛 UV-K5 / K6 原厂 | 1–200 | 对应驱动设置 | 上游参考镜像；待本项目实机 |
| 泉盛 UV-K5 / K6 Egzumer | 1–200 | 对应驱动设置 | 上游参考镜像；待本项目实机 |
| 泉盛 UV-K5 / K6 LOSEHU | 1–200，按版本选择 ASCII / 早期中文 / GB2312 | 131–133 官方基础分支开放已核对的基本设置 | 非扩容 132 实机读取与 101 条信道零差异重编码；其他分支软件验证 |

宝锋 UV-5RH 不等于 GM-5RH、GPS / Pro / Mini、UV-5RM 等近似型号；泉盛原始 K5 系列不能与 UV-K5 V3、UV-K1 等新硬件混用。LOSEHU 是否支持由设备版本返回值与驱动识别规则决定，不能只凭“2 Mbit”推断全部功能都兼容。

本项目扩展固定的 `uvk5_cn`，按 K5Web 配置表及官方源码匹配 LOSEHU 112–133 的已知分支。完整范围、容量默认值与硬件验证限制见 [自动适配说明](../docs/LOSEHU_COMPATIBILITY.md)。未知版本停止读写，未映射菜单不猜测地址。基本设置来源：

- <https://github.com/losehu/uv-k5-firmware-custom/blob/49222a9f431a006dfaaaa665b839e4953b1a1882/settings.c>
- 同提交 `settings.h`、`ui/menu.c`。

旧写频脚本将早期侧键放在 `0xE91..0xE94`，当前固件部分位置已用作 MDC ID；本项目不沿用该侧键映射。校准、密码、字库、多系统引导和不确定的扩容配置不开放修改。LOSEHU 正常上传范围为 `0x0000..0x1cff`（地址小于 `0x1d00`）；保持校准和更高区域不写入。

## 文件与写入

- 导入带型号与固件元数据的 CHIRP `.img`，或读取目标电台。裸 EEPROM / 固件 BIN 不作为配置镜像载入。
- `.radio.json` 保存原镜像、编辑后的信道和设置修改；重新导入后仍可继续编辑。
- 导出 IMG 时先在浏览器调用驱动验证、编码，然后下载。
- 支持表格导入，以及从 `.d500.json` 迁移信道；不把 D500 的整机设置迁移到其他型号。名称与频段不兼容时显示问题，需要编辑后才能写入。0 起始信道迁移到 1 起始机型时整体加 1，导入预览可核对编号。
- 读取成功自动下载原始 IMG 备份。新增型号遵循 CHIRP 既有的整块配置上传范围，不声称支持硬件增量写入；没有另加自动重读或回读。
- D500 的 DAT、增量写入、模板保护和已有草稿保持原逻辑。

⚠️ 刷写有风险，请先备份电台原始配置。使用本软件造成的数据丢失、设备损坏等后果由使用者自行承担，作者不承担责任。

## 开发验证

`sh scripts/test-radio-core.sh` 下载并校验固定提交的公开参考镜像，再运行 Python 编解码测试。Python 仅供开发测试，访问网页的使用者无须安装。测试镜像不会进入源码或网页发行包。前端与浏览器串口适配测试用 `npm test`。

`vendor/chirp.zip` 包含固定提交的未修改 CHIRP 核心和驱动源码；固定版本、哈希及测试镜像哈希见 `vendor/UPSTREAM.json`。ZIP 内含上游 GPL 许可。Pyodide 版本固定于 package-lock.json，许可及对应源码入口见 PYODIDE-NOTICE.txt。

作者：BA7KTC / JukZeon。

逐型号的独立项目核对、差异与实机证据见 [MODEL_RESEARCH.md](../docs/MODEL_RESEARCH.md)。
