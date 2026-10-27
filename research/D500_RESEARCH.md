# 即时通 D500 旧版二次开发资源调查

调查日期：2026-10-27。目标：无航空 AM 接收的旧版 D500，按官网命名应对应 V1，仍需以实机版本或菜单范围核对。

## 结论

- 找到了旧版官方写频软件、USB 写频线驱动、中英文说明书，已下载到本目录。
- 找到公开源码项目 K1toD500，适合研究信道文件格式和导入导出；它的说明指向 V2 写频软件，未确认兼容 V1。
- 本次检索未找到可确认适用于旧版的官方固件镜像、升级器、固件源代码、SDK、公开串口协议或成熟第三方替代固件。未找到不代表厂商内部或未公开渠道没有。
- CHIRP 当前官方支持列表未列出 D500。不能凭同品牌其他型号的支持情况推断兼容。

## 版本核对

1. [旧版官方 CPS / VIP V1](https://www.zastone.com.cn/download/showdownload.php?id=197)：页面说明仅支持 V1，功能菜单为 0–57。
2. [2026 V2.0 CPS](https://www.zastone.com.cn/download/showdownload.php?id=290)：页面说明仅支持带航空接收的 2026 款，不能写 V1；菜单为 0–60。
3. [V2 官方功能介绍](https://www.zastone.com.cn/news/shownews.php?id=147)：介绍新增航空 AM 接收和 U 段一键对频。

官网 V2 标题里的“202610”是软件版本标识；页面发布日期另列为 2026-04-21，本报告不把二者混为同一日期。

## 已下载的官方资源

| 资源 | 官方页面 | 本地文件 |
| --- | --- | --- |
| V1 写频软件 VIP 版 | https://www.zastone.com.cn/download/showdownload.php?id=197 | D500_V1_official_CPS.rar |
| 写频线 USB 驱动 | https://www.zastone.com.cn/download/showdownload.php?id=208 | D500_official_USB_driver.zip |
| 中文说明书 | https://www.zastone.com.cn/download/showdownload.php?id=205 | D500_official_manual_CN.pdf |
| 英文说明书 | https://www.zastone.com.cn/download/showdownload.php?id=204&lang=en | D500_official_manual_EN.pdf |

实际下载成功，并检查了文件类型。来源、原始文件名、大小和 SHA-256 见 sources.json。未安装或运行 Windows 程序，也未连接或读写实机。

### V1 写频软件包的静态检查

RAR 包含 D500_CPS/D500_vip_CPS.CAB、setup.exe 和 SETUP.LST。安装清单记录主程序 D500_vip_CPS.exe 版本为 1.0.0.0，时间字段为 2024-11-19；该字段不等于电台固件版本。

CAB 的文件清单是主程序、VB6 运行库、MSCOMM32.OCX 等控件和安装工具，没有单独的固件镜像或明确命名的固件升级器。VB6 与串口控件依赖可作为后续研究写频程序的线索；单靠这些文件名不能确认通信协议或电台 MCU。

注意：官网把 USB 写频线驱动放在“固件升级”分类下，但下载内容是驱动安装程序，不是电台固件。

## 公开源码：K1toD500

- 仓库：https://github.com/Liuli-Lumine/K1toD500
- 语言：C++ / Win32；许可证：GPL-3.0。
- 功能：信道表格 .xlsx 与 D500 写频软件 .dat 双向转换，最后通过原厂软件写入电台。
- 仓库创建于 2026-10-20；本次保存的提交为 e65cbb309986f0f37babaae7fac77f9fd21b5ab1（2026-10-21）。
- 完整源码快照：K1toD500_source.zip；另保留 README、格式编解码源文件和许可证供快速查阅。
- README 使用 2026 V2.0 CPS，并未明确声明 V1 已验证。因此只能作为候选参考，不能直接当作你的旧版可用工具。
- 重点源码：src/d500dat.h、src/d500dat.cpp、src/core.cpp、src/reverse.cpp。
- 格式代码可参考频率 BCD、亚音、功率、带宽和名称等字段；必须先用 V1 原厂软件导出的文件验证布局。
- 仓库中的 data/base.bin 是写频文件生成基准数据，不是可刷入电台的官方运行固件。
- 该项目不是固件工程，也不负责与电台直接通信。

## 其他资源与检索边界

- [RT Systems ZPS-D500](https://www.rtsystemsinc.com/ZPS-D500-Programming-Software-Only-for-thebr-Zastone-D500-Radio-_p_2414.html)：商业 Windows 写频软件，明确涉及原版 D500；无公开源码。检索时软件单独售价 25 美元，价格以网站为准。页面关于新 2026 款的描述存在前后不一致，本报告仅把它作为原版软件的商业备选。
- [CHIRP 官方支持列表](https://chirpmyradio.com/projects/chirp/wiki/Supported_Radios)：检索时 Zastone 部分无 D500；未找到可验证的 D500 驱动。
- [FCC ID 2AJTBD500](https://fccid.io/2AJTBD500)：索引列出厂商提交的 Internal Photos、External Photos、User manual，可作为硬件研究线索；本次未取得和核对内部照片，不能确认与你的 PCB 版本一致，也没有据此判断 MCU 型号。
- GitHub API 检索了 zastone d500、即时通 D500、D500 radio、D500 firmware radio，并检查 README 中的相关匹配；与本机型直接相关的公开源码结果是 K1toD500。其他无关品牌项目未当作 D500 兼容项目。
- 检查了官网中文下载目录第 1–9 页的相关条目；英文首页取得英文说明书入口，但额外英文分页请求返回 404，因此不宣称穷尽所有历史资源。

## 建议的开发路线

1. 先开发旧版信道文件工具：用 V1 官方 CPS 读出并保存原始 .dat，再各改一个字段另存，比较文件差异；确认 K1toD500 格式能否复用。实现批量信道编辑、CSV/Excel 导入导出，并保留未知设置。
2. 再研究直接写频：先捕获原厂软件的只读通信，确认接口电平、串口参数、握手、地址范围、读写指令及校验，再开发 Python/macOS 工具或 CHIRP 驱动。当前尚没有这些实机证据。
3. 如果目标是改机器内部菜单、扫描或界面，需先识别主板、主控和存储、确认读取及恢复路径、备份固件和校准数据。当前资料还不足以判断自定义固件的工作量和可行性。

下一步最有价值的实机材料：版本信息、菜单末项、V1 CPS 读出的原始 .dat 和仅修改一个已知字段后的 .dat。固件方向另需清晰的 PCB 和芯片丝印照片。
