# CPU 温度：驱动加载实查与一键启用

2026-11-07 在这台 Windows 11 / Ryzen 7 9700X 上核对。

## Core Temp 的本机证据

图吧工具箱中的 `tools\处理器工具\CoreTemp\Core Temp x64.exe`。同目录没有单独的 SYS 文件。

Windows System 日志的 Service Control Manager 事件 7045 记录了 Core Temp 启动时的驱动注册：

- 2026-11-07 02:55:31、02:57:52、02:57:57（本地时间）。
- 服务名称：`ALSysIO`。
- 文件：`%LOCALAPPDATA%\Temp\ALSysIO64.sys`。
- 类型：内核模式驱动，按需启动。

后续检查时 Core Temp 进程、ALSysIO 服务与该临时 SYS 均未保留。由实际日志可确认它使用临时路径的按需内核驱动；结合无外置 SYS 的目录，符合程序释放并加载驱动的方式。没有抓取完整 API 调用轨迹，不能将“退出时如何清理”等具体内部实现当作已追踪事实。本次未执行准备过的管理员诊断脚本，也未提取、复制或复用 Core Temp 私有驱动。

官方作者也明确解释 ALSysIO 是 Core Temp 的驱动：
https://www.alcpu.com/forums/viewtopic.php?t=292

## 本项目的实现

仍由 LibreHardwareMonitor 0.9.6 直接读取硬件，不依赖 Core Temp 进程、共享内存或图吧工具箱。使用独立的官方签名 PawnIO 2.2.0 驱动；不是复制 Core Temp 的 ALSysIO。

点击“启用 CPU 温度”后，仅提升一次 Windows PowerShell 启动器的权限。在同一个已提升权限的进程中：

1. 通过停止文件和独占锁等待本应用旧采集器退出。
2. 检测 PawnIO 安装版本；需要时校验随包安装器的固定 SHA256 和官方 Authenticode 签名，然后静默初始化官方版组件。
3. 检查并启动 PawnIO 驱动服务。
4. 以继承的管理员权限启动 SensorHelper，不产生第二次 UAC。
5. 确认新鲜、有效的 CPU 温度后报告成功。

不关闭安全功能，不创建自动提权任务。系统组件会保留在 Windows 已安装应用和驱动库中，可通过系统卸载；与 Core Temp 临时驱动的生命周期并不相同。“一次授权”指一次启用操作，不承诺此后所有 Windows 会话永久免 UAC。

打包时携带安装器、许可证、来源记录和启动脚本；用户不需要单独下载安装 PawnIO。固定来源：
https://github.com/namazso/PawnIO.Setup/releases/tag/2.2.0

SHA256：`1F519A22E47187F70A1379A48CA604981C4FCF694F4E65B734AAA74A9FBA3032`。

## 验证

- 单元测试覆盖零温度重启、旧操作状态隔离、取消授权、缺少资源、驱动失败和重启提示。
- Windows PowerShell 5.1 实际执行状态写入函数两次，验证状态文件原子替换，避免 null 备份路径被转换为空字符串导致失败。
- 首次实机准备后：`usbrndis6` 与温度驱动无关；本次温度驱动为运行中的 `PawnIO`，版本 `2.2.0.0`。
- 原生采集器管理员权限为 true，无 error，`Core (Tctl/Tdie)` 读到约 49.38°C，`CCD1 (Tdie)` 约 43.38°C。
- 桌面显示“CPU 温度已连接”，Core Temp 当时未运行。

温度随负载变化，上述数值只表示该次实测，不是固定预期值。
