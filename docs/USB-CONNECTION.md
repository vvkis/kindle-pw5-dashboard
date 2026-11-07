# Windows USB 连接指南

本应用通过 USB 网络上的 SSH/SCP 把图片发送到 Kindle，再调用设备的 `eips` 刷屏。电脑和 Kindle 不需要连接同一路由器，但设备必须已越狱，并通过 Jobman 或其他兼容工具提供 USB SSH。普通的 USB 文件传输模式不能用于持续推图。

## 1. 开启设备端 USB SSH

1. 在 Kindle 上打开 Jobman，启用 USB SSH / USB 网络功能；名称以安装版本为准。
2. 用支持数据传输的 USB 线连接电脑，优先直连电脑 USB 接口。
3. 打开 Windows 设备管理器，检查插入后新增的设备。

| 设备状态 | 下一步 |
| --- | --- |
| 网络适配器中已有可正常工作的 Kindle RNDIS 网卡 | 跳到第 4 节配置 IP，不必重装驱动 |
| 显示“USB 串行设备（COM…）” | 按第 2、3 节核对硬件 ID 并安装匹配包 |
| 仍显示 Kindle 磁盘 | 检查设备端是否切换到 USB 网络模式 |
| 未知 USB 设备、设备描述符请求失败 | 先换数据线、直连接口并检查设备状态；此时不应强绑 RNDIS 驱动 |

不要只凭 COM 编号选择设备：拔插 Kindle，确认该设备随之出现和消失。

## 2. 核对硬件 ID 与驱动来源

设备管理器 → 目标设备 → 属性 → 详细信息 → 硬件 ID。本指南所用匹配包针对：

```text
USB\VID_0525&PID_A4A2
```

如果 ID 不同，停止此安装路线，查找适配该设备的方案；不要修改 INF 硬套。

本项目在 Windows 11 / Kindle PW5 上最终使用了 **Marco77 的 `kindle_rndis.inf_amd64-v1.0.0.1.zip`**：

- [作者原帖与安装说明](https://www.mobileread.com/forums/showthread.php?p=3283986)
- [原帖附件下载](https://www.mobileread.com/forums/attachment.php?attachmentid=147204&d=1458474020)

这份包提供硬件 ID 匹配信息，引用 Windows 自带 `netrndis.inf`，没有另带自编译 SYS。本机安装记录确认设备名称为 `Kindle USB RNDIS Device (USBNetwork enabled)`、服务为 `usbrndis6`、问题代码为 0；随后完成了 USB SSH 推图验证。原帖发布于 2016 年，不能据此保证适用所有 Windows 版本和安全策略。

排障期间还准备过一份本地测试 INF，但它不是最终安装成功的方案。也不要继续使用此前导致本机“网络连接”窗口卡顿的 Acer 2010 年旧包（显示名可能为 `USB Ethernet/RNDIS Gadget`）。设备显示名及 INF 中的 `NT.5.1`、`UpperRange=ndis5` 字样都不能单独证明实际使用哪一代驱动，应检查最终服务及驱动文件。

### 包完整性与证书

从作者来源下载并解压。项目核对过的文件 SHA-256 如下；若不一致，应重新核对来源，不要继续按此记录安装。

| 文件 | SHA-256 |
| --- | --- |
| `kindle_rndis.inf` | `B0E1FFB19759F0AD6E27955201CE1A5741B3749B413C0B1F6E752A7477F8055F` |
| `kindle_rndisamd64.cat` | `C73099AF851AD739CCB8A6F2559BAD3A240DA5DB904C1906D246F79541902EDA` |
| `MobileRead-CodeSigning-CA.cer` | `E9D349C197A8872CD1C09DEB1C1F11D4A6F3555C40B9BFDEB0DF622880E0AB64` |

在 PowerShell 中用 `Get-FileHash -Algorithm SHA256 -LiteralPath '文件完整路径'` 检查。哈希相同表示文件与本次核对的副本相同，不代表微软认证。

包里的 CAT 使用作者自签证书，**不是微软 WHQL 签名**。作者的 `5-runasadmin_register-CA-cer.cmd` 会把附带证书加入整台电脑的“受信任的根证书颁发机构”和“受信任的发布者”；这是系统信任变更。先检查脚本和证书，了解并接受该信任范围后，才以管理员身份执行。核对过的证书指纹为 `58E285D47509E810DCCFA865A8F6D99B8A297FA5`。

普通安装无需运行包里的 1–4 号制证、生成 CAT 或签名脚本，也不需要自行生成新的密钥。若不接受该证书信任方式，或系统策略拒绝安装，先停止并保留错误信息；本指南不要求关闭安全启动、内存完整性或驱动签名检查。

## 3. 安装并确认绑定

如果之前装了旧 Acer 包，先在设备管理器中核对目标 Kindle 设备、驱动提供商、版本和 INF 发布名称。仅卸载对应的旧设备及旧第三方驱动包，再拔插 Kindle。不要删除微软系统 INF，也不要批量删除其他网卡驱动。

完成第 2 节的来源、文件与证书核对后：

1. 保持 Kindle 的 USB 网络模式开启并插着 USB。
2. 设备管理器 → 目标串口或未知设备 → 更新驱动程序。
3. 选择“浏览我的电脑以查找驱动程序”，指定解压后包含 `kindle_rndis.inf` 的文件夹。
4. 如果使用“让我从计算机上的可用驱动程序列表中选取 → 从磁盘安装”，选择的是这份 **Kindle 专用 INF**。
5. 安装后确认设备进入“网络适配器”，没有黄色感叹号。

直接选择 `C:\Windows\INF\netrndis.inf` 或 `rndiscmp.inf`，可能因为缺少对应硬件 ID 或当前设备被识别成串口而无法匹配。“兼容硬件”列表只有 USB 串口时，反复在该列表中选择不会解决问题，不能当作设备不支持 USB 网络的依据。

可在普通 PowerShell 检查当前连接的设备：

```powershell
$devices = @(Get-PnpDevice -PresentOnly | Where-Object {
    $_.InstanceId -like 'USB\VID_0525&PID_A4A2\*'
})
$devices | Format-Table Status,Class,FriendlyName
foreach ($device in $devices) {
    Get-PnpDeviceProperty -InstanceId $device.InstanceId |
        Where-Object { $_.KeyName -match 'DriverInfPath|Service|ProblemCode' } |
        Format-Table KeyName,Data
}
```

预期设备类 `Net`、服务 `usbrndis6`、问题代码 0。`oemNN.inf` 的编号每台电脑不同，不能照抄别人的编号。驱动程序详细信息可辅助检查 `usb80236.sys` / `rndismp6.sys`；部分依赖文件不一定直接列出。

## 4. 给 Kindle 网卡设置静态 IPv4

打开控制面板 → 网络连接，按网卡描述识别 **Kindle USB RNDIS**，不要选电脑正在上网的以太网、WLAN、VPN 或 WSL 虚拟网卡。连接名称可能叫“以太网 2”，以描述为准。

右键该网卡 → 属性 → Internet 协议版本 4（TCP/IPv4）→ 属性，填写：

| 项目 | 值 |
| --- | --- |
| 电脑 IP 地址 | `192.168.15.201` |
| 子网掩码 | `255.255.255.0` |
| 默认网关 | 留空 |
| DNS | 留空 |
| Kindle 地址 | 默认示例为 `192.168.15.244`，需与设备端设置一致 |

这是一条电脑与 Kindle 之间的独立连接，不需要网络桥接、Internet 连接共享或配置默认网关。“未识别的网络”“无 Internet”可以是正常状态，关键是 SSH 是否可达。若其他网卡也使用同一子网，先解决地址或路由冲突。

## 5. 测试 SSH、公钥登录和应用推送

在电脑终端执行；`-b` 指定电脑侧 USB 地址：

```powershell
ssh -b 192.168.15.201 root@192.168.15.244
```

首次连接先核对 Kindle 的主机指纹，再接受并保存到 `known_hosts`。设备端的密码或公钥要求以 Jobman / SSH 配置为准，不假定某个通用默认密码。

可以沿用已有 SSH 密钥对。`id_rsa` 是留在电脑上的私钥，`id_rsa.pub` 是可放到 Kindle 授权列表的公钥；应用的“私钥”字段必须选择前者。根据设备 SSH 服务的说明，把公钥加入 root 用户实际使用的 `authorized_keys`；不要将私钥复制到 Kindle、仓库或 Release。已有授权列表应追加公钥，不能覆盖其他条目。

用实际的私钥路径测试非交互登录：

```powershell
ssh -b 192.168.15.201 -i "$env:USERPROFILE\.ssh\id_rsa" -o BatchMode=yes root@192.168.15.244 "echo USB_SSH_OK"
```

若私钥有口令，应先配置并解锁兼容的 SSH agent。看到 `USB_SSH_OK` 后退出远程终端，打开应用 → 设备连接 → USB 网络同步，保存 Kindle 地址、端口和私钥路径，依次执行“检测连接”“推送到 Kindle”。每次启动后需要持续刷新时，再开启自动推送。

## 常见问题与日常使用

| 现象 | 检查方向 |
| --- | --- |
| 插入 Kindle 后只有“网络连接”窗口卡住，其他软件正常 | 拔掉 Kindle 先恢复界面，在设备管理器核对驱动；本机曾在旧 Acer 包上复现，更换上述匹配包后恢复，不能把所有卡顿都归因于同一个原因 |
| 找不到“USB RNDIS6 Adapter” | 检查硬件 ID，按专用 INF 安装；不要只依赖系统型号列表 |
| Code 52、签名错误、安装失败 | 保留完整报错和 `C:\Windows\INF\setupapi.dev.log` 对应记录，检查包完整性、证书信任及系统策略 |
| SSH 超时 | 检查 USB 模式、电脑 IP、数据线、设备地址和 SSH 服务；`ping` 失败本身不能证明 SSH 不通 |
| `Connection refused` | 地址可达但端口没有接受连接，检查 Jobman 的 SSH 开关和端口 |
| `Permission denied (publickey)` | 网络已到达 SSH 服务，检查公钥授权、所选私钥与 agent |
| 主机密钥变化警告 | 先核实是否重装设备或连接到了另一台机器，再处理旧记录；不要关闭主机验证 |

驱动和静态 IP 通常只需安装、设置一次；同一电脑下次插入仍会复用。更换电脑、系统重装或网卡被重新枚举时，可能需要重新配置。设备端 USB SSH 是否跨重启保留取决于 Jobman 的设置，应在重启后确认。

用完先关闭自动推送，退出应用或断开连接。拔掉 USB 后，电脑不再能推图；Kindle 可返回主页继续阅读。如果要在电脑上正常复制书籍，先在设备端关闭 USB 网络模式、恢复 USB 存储模式，再重新插线；USB 网络模式下看不到原来的磁盘不代表书籍丢失。日常不使用时可以关闭 USB SSH，需要看板时再开启，无需为普通阅读一直保持调试连接。

此指南不包含个人配置、密钥或设备备份，也不随应用重新分发第三方驱动包和信任证书。驱动来源与系统信任步骤应由安装者自行核对。

## 参考

- [Marco77：Kindle USBNetwork 的 Windows 匹配包与原理](https://www.mobileread.com/forums/showthread.php?p=3283986)
- [微软：Remote NDIS INF 模板](https://learn.microsoft.com/en-us/windows-hardware/drivers/network/remote-ndis-inf-template)
