# Kindle Monitor

Windows 桌面小组件编辑器 + Kindle PW5 电脑状态看板。Electron 桌面应用，不需要 Python 才能运行打包版本。

## 直接运行

从 [GitHub Releases](https://github.com/vvkis/kindle-pw5-dashboard/releases/latest) 下载 `Kindle-Monitor-<版本>-win-x64.zip`。完整解压到一个文件夹后，运行 `Kindle Monitor.exe`。同页的 `Kindle-Dashboard-Plugin-<版本>.zip` 用于安装 Kindle 端插件。

本地构建结果：`dist/win-unpacked/Kindle Monitor.exe`。

- 时间与日期、周边天气、CPU 温度、GPU 温度/占用率/功耗、内存和显存占用。
- 竖屏采用 4 × 6 网格，横屏采用 6 × 4 网格，两套排版分别保存。时钟、天气、日历、便签、温度仪表、内存条、系统列表、曲线各自有独立设计。
- 点击「编辑显示」，在右侧预览中拖动小组件；同尺寸可以交换位置，大组件也能与其覆盖范围内的小组件组交换。可改名、缩放、添加、移除，组件不能越界或重叠。也提供方向按钮。
- 小组件支持 1 × 1、2 × 1、2 × 2、4 × 2；横屏还支持 6 × 1 的全宽组件。桌面满时需先缩小或移除组件。
- 添加「图片」组件可导入 PNG、JPG、WebP，选择灰阶或纯黑白抖动。在「图片构图」选择完整显示或铺满裁剪，再调整缩放和取景位置。保存排版后，构图会随看板一起推送或导出。
- 编辑后保存，预览与实际 PNG 共用一份 SVG 排版。竖屏导出 1236 × 1648，横屏导出 1648 × 1236，均为 8-bit 灰阶 L PNG。
- 预览区域内直接缩放：点击画面后使用 Ctrl + 滚轮，或上方 − / ＋、适应、100% 控件（10%–200%）。放大后滚动查看，仍能拖动编辑小组件；不改变组件排版或导出尺寸。
- 墨水屏使用随包内置的 **Maple Mono NF CN**，默认加粗，可在「设置 → 屏幕与显示」选择常规。
- 选中「文字便签」后可独立编辑备忘录内容，支持换行、最多 2000 字；每个组件和横竖屏排版分别保存。旧便签保留原内容，底部留言仍可单独修改。

## 横屏摆放

在「设置 → 屏幕与显示 → 摆放方向」中选择横屏。横屏使用独立排版，可以继续拖动、调整大小；切回竖屏会恢复原先的竖屏排版，保存后两套排版都保留。

横放时请选择设备原来的顶部朝向左侧或右侧。预览和导出图片保持正常可读的横屏尺寸。HTTP 推送会读取 KOReader 当前的屏幕方向，再按设备的物理摆放旋转图片。SSH 使用 eips 刷屏时，图片会转为 Kindle 原生 1236 × 1648 像素坐标。左右两种方向均有像素角点和模拟推送测试，真实硬件显示方向仍需设备联调确认。

## 后台省内存

点击窗口右上角「后台省内存」，应用先保存当前设置，再销毁控制面板及其渲染进程。电脑采集、天气更新和已经开启的自动推送继续在后台运行。双击 Windows 托盘图标恢复编辑界面，右键托盘可立即推送、开关自动推送或退出。需要持续同步时，请先打开自动推送；后台按钮不会擅自开启它。普通关闭窗口仍为退出应用。

Maple Mono NF CN 字体和原有横竖屏排版全部保留。PNG 使用临时导出进程，完成后退出以释放字体解析和栅格化内存。默认关闭界面硬件加速，适合当前静态看板；可通过 EXE 的 `--enable-gpu` 参数恢复硬件加速。

本机实测私有内存：前台约 217 MiB，托盘后台约 101 MiB，原生传感器进程另外约 52 MiB。是分别测量的数据，实际占用随硬件和运行状态变化；瞬时导出会短暂增加一个进程。详见性能文档。

## 温度与真实数据

CPU 占用和物理内存使用由系统读取；NVIDIA 默认通过驱动的 nvidia-smi 查询。点击「启用 CPU 温度」并完成一次 Windows 管理员确认，程序会自动校验和准备随包的硬件访问驱动，再启动原生 .NET / LibreHardwareMonitor 采集器；无需另行下载或手动安装 PawnIO，也不依赖 Core Temp。桌面界面本身保持普通权限。首次准备会在 Windows 中安装官方签名的 PawnIO 2.2.0 系统组件（可在 Windows 已安装的应用中卸载），以后不重复安装；每次重新启动需要管理员权限的采集器时，Windows 仍可能要求授权。程序不创建自动提权服务或计划任务。

只有读到有效 CPU 温度才显示“已连接”。启动中、驱动准备失败、取消授权、需要重启 Windows 等状态分别提示，详细结果写入本地 `sensor-start.json` 和 `sensor-setup.log`。驱动由官方发布，打包及首次运行均校验固定 SHA256 和 Authenticode 签名；不会关闭系统安全设置。组件准备和旧采集器退出均有超时限制。

采集器只启用 CPU/GPU，不扫描主板、硬盘或 SPD。运行时自动使用常驻采集器的数据，避免每轮启动 PowerShell；NVIDIA 与 AMD 核显共存时优先选择 NVIDIA 独显。无传感器、超时、无效的 0°C 数据明确显示不可用。不同硬件和 Windows 驱动策略可能影响 CPU 温度读取，需在本机授权后验证，不能保证所有型号。

「设置 → 采集与推送」可调整看板数据的本机采集间隔（1–300 秒，默认 3 秒），推送间隔单独设置。曲线使用最近 3 分钟的采样。辅助进程通过停止文件和桌面心跳退出；应用异常退出后最多约 45 秒停止采集器。应用关闭后不会保持定时推送。

天气使用 Open-Meteo 周边网格预报，每 15 分钟更新，断网保留本次运行的缓存并标记。支持城市搜索与直接编辑 WGS84 经纬度。天气不是现场观测；设置和位置数据保存在本机，不提交 Git。

## 安装 KOReader 插件与 Wi-Fi 推送

Kindle 需已安装可运行的 KOReader。看板模式通过局域网 HTTP 收图，日常推送只需要电脑和 Kindle 在同一个可互通的 Wi-Fi 网络上。

### 安装或升级

1. 解压 Release 中的 `Kindle-Dashboard-Plugin-<版本>.zip`，得到 `dashboard.koplugin` 文件夹。使用源码时，也可以取 `kindle-plugin/dashboard.koplugin`。
2. 退出 KOReader，用 USB 磁盘模式连接 Kindle。将整个 `dashboard.koplugin` 文件夹复制到 Kindle 盘的 `koreader/plugins/`。升级时覆盖同名文件夹中的插件文件。最终路径应为 `/mnt/us/koreader/plugins/dashboard.koplugin/main.lua`。
3. 安全弹出 Kindle，拔掉 USB 并重新启动 KOReader。打开顶部菜单最右侧一页（历史、收藏、退出所在的菜单），第一项是「看板模式」。也可以在手势管理器里绑定入口。

升级 Windows 端时，将新版 ZIP 完整解压到新目录。要迁移布局、图片组件和连接信息，退出旧程序后，把旧版 EXE 旁的 `Kindle Monitor Data/settings.json` 复制到新版的同名目录，再启动新版。

### 通过 Wi-Fi 更新画面

1. 将电脑和 Kindle 连到同一 Wi-Fi，打开 Kindle 的「看板模式」。记下屏幕上的 IPv4、端口（默认 `8686`）和 8 位配对口令。长按菜单中的「看板模式」也可以查看「连接信息」、改端口、改检查间隔或重新生成口令。
2. Windows 端打开「设置 → Kindle 连接」，选择「看板插件 (HTTP)」，分别填入 IP、端口和口令，点击「检测连接」。若重新生成了口令或换网后 IP 发生变化，在这里更新并检测一次。
3. 点击「推送到 Kindle」立即更新画面，或在「设置 → 采集与推送」开启自动推送。横放时，在「设置 → 屏幕与显示」选横屏，再选设备原来的顶部朝左或朝右。

等待画面和已推图时的黑字白底连接条都会显示连接信息。点连接条可隐藏，长按看板可重新显示。插件收到 PNG 后先写临时文件，再替换 `/mnt/us/dashboard.png` 并刷新。单张 PNG 最大 8 MB，上传和状态接口都需要口令。

打开看板时屏幕保持点亮，耗电增加，长时间使用请接着充电。关闭看板、按电源键或退出 KOReader 时，插件会关掉 HTTP 服务，并撤销自己加过的防休眠。若进程崩溃，Kindle 上 `/tmp/kdash.lease` 约 90 秒没有更新后，会把 `preventScreenSaver` 设回 0。不往 `/mnt/us` 写常驻程序，不改屏保、月读的 `screensaver_*` / `book_*` 设置，也不碰 `.moon/`。非 Kindle 设备会跳过 `lipc`。

已在设计上对齐 Kindle PW5 固件 5.18.1、KOReader 2026.7.2 与月读插件并存；实机显示、防火墙和保活仍需在设备上确认。从文件管理器打开一本书时，KOReader 会拆掉文件管理器里的插件实例，看板会关闭；进入阅读器后在主菜单再开一次即可。

## USB / Wi-Fi 同步（SSH，可选）

不用看板插件时，仍可通过 SSH 推送。设备需先完成兼容越狱、USBNetwork 和 SSH 公钥配置。普通 USB 磁盘连接不提供实时刷屏。

**首次使用 Windows USB 连接，请先看 [USB 网卡驱动与连接指南](docs/USB-CONNECTION.md)**：包含 Jobman USB SSH、被误识别成 COM 串口的处理、已验证的 Kindle 专用驱动来源、静态 IP、公钥配置及“网络连接”窗口卡顿排查。驱动安装和网卡 IP 通常只需配置一次。

1. Kindle 常见 IP：`192.168.15.244`，电脑侧通常配置 `192.168.15.201/24`，以设备实际设置为准。
2. 首次 `ssh root@192.168.15.244`，核对主机指纹后保存到 known_hosts。
3. 在应用的「设置 → Kindle 连接」中选择 USB 网络同步，保存地址、端口、私钥，点击检测连接。
4. 手动推送或开启自动推送；开启时立即同步，此后显示的时间每变化一分钟必须推送，同时按自定义的 1–3600 秒间隔更新数据（默认 60 秒）。设为 300 秒也仍在每分钟变化时推送。每次重启自动推送默认关闭；开启后在托盘后台继续执行。

在「设置 → Kindle 连接」选择「Wi-Fi 无线同步（SSH）」，填写 Kindle 在局域网中的无线 IP 或主机名，保存后检测连接。USB 地址与 Wi-Fi 地址独立保存，共用 SSH 端口和私钥。电脑与 Kindle 必须网络互通，Kindle 已启用无线 SSH（例如设备端 USBNetwork 的 Wi-Fi SSH 功能）；应用不会替设备开启无线 SSH。首次连接无线地址也需核对并信任 SSH 指纹。检测成功后可拔掉 USB，使用同样的手动/自动同步功能。

同步不会并发上传；分钟切换发生在上传期间时，完成后补推最新时间。失败后每 5 秒重试，恢复后直接同步最新画面，不补传过期画面。设备实际刷新完成时间包含图片生成、网络传输和屏幕刷新耗时。

推送采用 legacy SCP，先校验 PNG，再上传到 `/mnt/us` 上的唯一临时文件，确认非空后原子改名为 `/mnt/us/dashboard.png`。默认接着调用 `eips -f -g`。若 Kindle 上开着看板插件、却仍想用 SSH 传文件，请在「设置 → Kindle 连接」关闭「推送后用 eips 刷屏」：这时上传的是预览方向的图片，不再为原生帧缓冲旋转，也不调用 eips，由插件看到文件变化后自己刷新。上传失败保留旧图；开启 eips 时刷屏失败会报错。SSH 保持严格主机验证。不会修改固件、Wi-Fi 或 OTA 设置。

推荐使用上面的看板插件 HTTP。SSH 的 USB / Wi-Fi 地址留给没有安装插件的设备。

已在 Windows 11 / Ryzen 7 9700X 与 Kindle PW5 上完成 USB SSH 推送及 CPU 温度读取验证；其他硬件、驱动策略和 Wi-Fi 网络仍需各自验证。

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

## 仓库与发布包

`desktop/` 是桌面应用与原生采集器源码，`scripts/` 是资源准备、构建、发布和性能工具，`tests/` 是当前桌面应用测试，`docs/` 是实现与性能说明。旧 Python 演示出图、假数据和 PowerShell 采集器已移除；开发只需 Node.js、pnpm 和 Windows 自带 .NET Framework。

`vendor/`、`node_modules/`、`runtime/`、`out/` 和各类缓存均不提交 Git。资源准备只保留实际使用的 Regular/Bold 字体和必要许可证。打包仅包含中英文 Chromium 语言包；编译源码、构建脚本和图标源文件不进入应用归档。

执行 `pnpm release` 生成 Windows ZIP、KOReader 插件 ZIP 和对应的 SHA‑256 文件。Windows ZIP 包含完整可运行程序及许可证。插件 ZIP 只包含 `dashboard.koplugin` 的三个 Lua 文件。发布包排除本机运行数据、日志和备份文件。

推送与 `package.json` 一致的 `v*` 标签后，GitHub Actions 会测试、打包并创建 Release 草稿。使用标题为 `Publish Kindle Monitor v<版本>` 的注释标签，可在测试和上传通过后直接发布。发布说明位于 `docs/releases/`。

## 上游

- [Electron 安全与隔离](https://www.electronjs.org/docs/latest/tutorial/security)：contextIsolation、sandbox、受限 preload、IPC 来源验证与 CSP。
- [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)：采集库；许可证及第三方声明随应用资源分发。
- [Maple Mono](https://github.com/subframe7536/maple-font)：字体；SIL OFL 许可证随字体分发。
- [Open-Meteo](https://open-meteo.com/en/docs)：天气预报；界面/组件注明数据来源。
