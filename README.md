# Kindle PW5 Dashboard

首版使用本地测试数据生成 **1236 × 1648、8 位灰阶 L 模式 PNG**，并提供 Windows PowerShell USBNetwork 推送脚本。图片明确标记 DEMO；天气、日程、待办均非实时信息。当前不安装越狱工具，不改固件、不控制 Wi-Fi、不配置设备休眠或自启动。

## 环境

- Windows PowerShell 5.1+ / PowerShell 7、uv、已有 Python 3.11+。
- Windows 默认使用系统微软雅黑；其他系统可通过 `--font` 指定中文字体。
- 推送需要 Windows OpenSSH 客户端，以及已越狱、已配置 USBNetwork / SSH 的 Kindle。

在本项目目录运行：

```powershell
uv sync --locked
uv run --locked python host/render_dashboard.py
```

若本机执行策略禁止直接运行 `.ps1`，可只为当前启动的进程执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File host/push_to_kindle.ps1 -RenderOnly
```

这不会修改系统或用户的永久执行策略。

依赖环境放在 `.venv/`，uv 缓存放在 `.uv-cache/`。项目配置禁止自动下载 Python，使用已安装的解释器。如果 uv 找不到可用 Python，可执行 `uv sync --locked --python '现有Python的完整路径'`。首次同步需要下载 Pillow，后续可以离线运行。

上述两个目录、`out/`、本地配置和日志都被 Git 忽略；`uv.lock` 提交以固定依赖版本。请勿把 SSH 私钥放进项目。

## 只生成图片

```powershell
.\host\push_to_kindle.ps1 -RenderOnly
# 固定时间，生成可复现的预览：
.\host\push_to_kindle.ps1 -RenderOnly -At '2026-11-06T09:00:00'
```

输出为 `out/dashboard.png`。脚本可以从其他工作目录调用；默认资源与输出路径均基于项目目录。`-RenderOnly` 不调用 SSH/SCP。

也可直接使用渲染器：

```powershell
uv run --locked python host/render_dashboard.py --data data/demo.json --out out/dashboard.png
uv run --locked python host/render_dashboard.py --out out/dashboard.png --validate-only
```

时间默认采用电脑当前时区，`--at` 可覆盖。编辑 `data/demo.json` 调整测试内容；真实个人数据请使用 `data/dashboard.local.json`（已忽略）。最多显示 3 项日程和 3 项待办，超出时提示剩余数量；长文本自动截断。

## 设备就绪后推送

以下步骤等待型号、固件和越狱状态确认后再做：

1. 在 Kindle 启用 USBNetwork；确认 Windows 正确识别网络适配器。常见 Kindle IP 为 `192.168.15.244`，电脑侧为 `192.168.15.201/24`，以设备实际配置为准。
2. 配置 SSH 公钥登录，首次执行 `ssh root@192.168.15.244`，核对设备主机密钥后保存到 known_hosts。
3. 确认设备提供 `eips` 且支持所需 PNG 刷屏方式；退出交互 SSH 后推送。

```powershell
.\host\push_to_kindle.ps1
# 自定义地址、公钥对应的本机私钥路径：
.\host\push_to_kindle.ps1 -KindleHost 192.168.15.244 -IdentityFile "$HOME\.ssh\id_ed25519"
# 推送一张现有图片（仍会先校验格式、完整解码、尺寸、灰阶）：
.\host\push_to_kindle.ps1 -SkipRender -ImagePath .\out\dashboard.png
```

支持 `-Port`、`-DataFile`、`-FontPath` 和 `-At`。脚本使用非交互 SSH；缺少密钥、密码登录或未知主机密钥会明确失败。使用 legacy SCP (`scp -O`) 兼容缺少 SFTP 的 Dropbear 环境。

推送过程：校验图片 → 检查设备目录和 eips → 上传唯一临时文件 → 原子替换 `/mnt/us/dashboard.png` → `eips -f -g` → 清理本轮临时文件。上传失败会保留旧图片；刷屏失败会报错，已替换的新 PNG 仍保留。脚本不会唤醒深睡中的设备，请先手动唤醒；暂不支持多个客户端并发推送。

## 验证

```powershell
uv run --locked python -m unittest discover -s tests -v
powershell -NoProfile -File tests/test_push.ps1
```

Python 测试覆盖 PNG 格式与完整性、可复现渲染、空数据与长文本、失败时保留旧输出。PowerShell 测试用替身命令检查推送顺序、失败处理和 RenderOnly，不连接 Kindle。实际刷屏效果、USBNetwork 连通性和续航需要实机验收。

## 后续

确认设备状态后接入 Kindle 客户端、Wi-Fi 定时拉图、休眠唤醒和 OTA 防护；再接入真实天气、日历和待办数据源。
