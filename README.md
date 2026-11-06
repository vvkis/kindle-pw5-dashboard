# Kindle Monitor

Windows 桌面小组件编辑器 + Kindle PW5 电脑状态看板。Electron 桌面应用，不需要 Python 才能运行打包版本。

## 直接运行

本机打包结果：`dist/win-unpacked/Kindle Monitor.exe`。双击运行，保留同目录所有文件，不要只拷走 EXE。

- 时间与日期、周边天气、CPU 温度、GPU 温度/占用率/功耗、内存和显存占用。
- 竖屏采用 4 × 6 网格，横屏采用 6 × 4 网格，两套排版分别保存。时钟、天气、日历、便签、温度仪表、内存条、系统列表、曲线各自有独立设计。
- 点击「编辑显示」，在右侧预览中拖动小组件；同尺寸可以交换位置，大组件也能与其覆盖范围内的小组件组交换。可改名、缩放、添加、移除，组件不能越界或重叠。也提供方向按钮。
- 小组件支持 1 × 1、2 × 1、2 × 2、4 × 2；横屏还支持 6 × 1 的全宽组件。桌面满时需先缩小或移除组件。
- 编辑后保存，预览与实际 PNG 共用一份 SVG 排版。竖屏导出 1236 × 1648，横屏导出 1648 × 1236，均为 8-bit 灰阶 L PNG。
- 界面、预览和导出均使用随应用打包的 **Maple Mono NF CN**。

## 横屏摆放

在「编辑显示 → 摆放方向」中选择横屏。横屏使用独立排版，可以继续拖动、调整大小；切回竖屏会恢复原先的竖屏排版，保存后两套排版都保留。

横放时请选择设备原来的顶部朝向左侧或右侧。预览和导出图片保持正常可读的横屏尺寸；USB 推送会把图片旋转到 Kindle 原生 1236 × 1648 像素坐标，适配物理摆放，无需依赖系统自动旋转或改动设备显示设置。左右两种方向均有像素角点和模拟推送测试，真实硬件显示方向仍需设备联调确认。

## 后台省内存

点击窗口右上角「后台省内存」，应用先保存当前设置，再销毁控制面板及其渲染进程。电脑采集、天气更新和已经开启的自动推送继续在后台运行。双击 Windows 托盘图标恢复编辑界面，右键托盘可立即推送、开关自动推送或退出。需要持续同步时，请先打开自动推送；后台按钮不会擅自开启它。普通关闭窗口仍为退出应用。

Maple Mono NF CN 字体和原有横竖屏排版全部保留。PNG 使用临时导出进程，完成后退出以释放字体解析和栅格化内存。默认关闭界面硬件加速，适合当前静态看板；可通过 EXE 的 `--enable-gpu` 参数恢复硬件加速。

本机实测私有内存：前台约 217 MiB，托盘后台约 101 MiB，原生传感器进程另外约 52 MiB。是分别测量的数据，实际占用随硬件和运行状态变化；瞬时导出会短暂增加一个进程。详见性能文档。

## 温度与真实数据

CPU 占用和物理内存使用由系统读取；NVIDIA 默认通过驱动的 nvidia-smi 查询。启动「启用 CPU 温度」会请求一次 Windows 管理员确认，以启动随包内置的原生 .NET / LibreHardwareMonitor 采集器。桌面界面本身保持普通权限。

采集器只启用 CPU/GPU，不扫描主板、硬盘或 SPD。运行时自动使用常驻采集器的数据，避免每轮启动 PowerShell；NVIDIA 与 AMD 核显共存时优先选择 NVIDIA 独显。无传感器、超时、无效的 0°C 数据明确显示不可用。不同硬件和 Windows 驱动策略可能影响 CPU 温度读取，需在本机授权后验证，不能保证所有型号。

采集每 3 秒一次；曲线保留最近约 3 分钟。辅助进程通过停止文件和桌面心跳退出；应用异常退出后最多约 45 秒停止采集器。应用关闭后不会保持定时推送。

天气使用 Open-Meteo 周边网格预报，每 15 分钟更新，断网保留本次运行的缓存并标记。支持城市搜索与直接编辑 WGS84 经纬度。天气不是校园现场观测；设置和位置数据保存在本机，不提交 Git。

## USBNetwork 推送

设备需先完成兼容越狱、USBNetwork 和 SSH 公钥配置。普通 USB 磁盘连接不提供实时刷屏。

1. Kindle 常见 IP：`192.168.15.244`，电脑侧通常配置 `192.168.15.201/24`，以设备实际设置为准。
2. 首次 `ssh root@192.168.15.244`，核对主机指纹后保存到 known_hosts。
3. 在应用的「USB 连接」中保存地址、端口、私钥，点击检测连接。
4. 手动推送或开启自动推送，默认 60 秒；每次重启自动推送默认关闭。

推送采用 legacy SCP，先校验 PNG，再上传唯一临时文件、原子替换 `/mnt/us/dashboard.png`，最后调用 `eips -f -g`。上传失败保留旧图；刷屏失败会报错。SSH 保持严格主机验证。不会修改固件、Wi-Fi、休眠或 OTA 设置。

**实机 USBNetwork、CPU 温度授权后的驱动读取、Kindle 刷屏效果仍待设备联调。**

## 本地开发：前端只用 pnpm

Node 22+、pnpm 10.20.0、Windows PowerShell 5.1+、Windows 自带 .NET Framework 4.7.2+。

```powershell
pnpm install --frozen-lockfile
pnpm prepare:assets
pnpm start
pnpm test
pnpm smoke
pnpm build
pnpm benchmark:memory
```

`prepare:assets` 从官方源下载固定版本 LibreHardwareMonitor v0.9.6 和 Maple Mono NF CN v7.9，验证发布资产 SHA256，保留许可证。应用只打包 Regular/Bold 两个字重，字体不安装到系统。运行/打包脚本使用 Windows 现有 .NET Framework 编译器构建轻量传感器宿主；不额外下载 .NET SDK，不再保留常驻 PowerShell 采集进程。

pnpm store/cache/state 位于 `.pnpm-store/`、`.pnpm-cache/`、`.pnpm-state/`；Electron 运行/构建脚本将二进制缓存固定到 `.electron-cache/`、`.electron-builder-cache/`。不使用 npm，不提交 node_modules、缓存、vendor、dist 或运行时数据。

开发数据在 `runtime/`；打包应用的数据位于 EXE 旁的 `Kindle Monitor Data/`，包括设置、图片、日志和 Chromium 缓存。通过应用「打开本地数据」查看。整个可移动目录放在有写入权限的位置。

## 性能测试

见 [性能实测](docs/PERFORMANCE.md)。采样、可见 Electron 窗口和常驻辅助进程分别测量；不要把采集器的内存误认为整个 Electron 应用内存。

```powershell
pnpm benchmark
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/benchmark-helper.ps1
# 先用系统 .NET Framework csc 编译脚本所用计量工具：
& C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe /nologo /out:out/ProcessMeter.exe '.\scripts\ProcessMeter.cs'
node scripts/benchmark.cjs 60
```

## 原始 Python 测试出图工具

原来的测试数据出图和 PowerShell 推送脚本仍可独立使用。Python 由 uv 管理，环境与缓存仅放本项目 `.venv/`、`.uv-cache/`，禁止自动下载解释器。

```powershell
uv sync --locked
uv run --locked python host/render_dashboard.py
powershell -NoProfile -ExecutionPolicy Bypass -File host/push_to_kindle.ps1 -RenderOnly
uv run --locked python -m unittest discover -s tests -v
powershell -NoProfile -ExecutionPolicy Bypass -File tests/test_push.ps1
```

这些旧脚本使用 `data/demo.json`，天气/日程/待办是假数据；应用使用独立的真实采集链路。它们不会覆盖应用配置。

## 上游

- [Electron 安全与隔离](https://www.electronjs.org/docs/latest/tutorial/security)：contextIsolation、sandbox、受限 preload、IPC 来源验证与 CSP。
- [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)：采集库；许可证及第三方声明随应用资源分发。
- [Maple Mono](https://github.com/subframe7536/maple-font)：字体；SIL OFL 许可证随字体分发。
- [Open-Meteo](https://open-meteo.com/en/docs)：天气预报；界面/组件注明数据来源。
