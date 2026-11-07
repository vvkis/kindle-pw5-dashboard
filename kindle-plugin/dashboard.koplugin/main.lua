--[[--
Fullscreen PC dashboard for Kindle.

While this view is open it keeps the device awake and listens for PNG uploads on
Wi-Fi. The listener is KOReader's SimpleTCPServer, polled with UIManager:insertZMQ,
the same pattern as the built-in HTTP inspector. On Kindle it also opens the
matching iptables hole and sets powerd preventScreenSaver, with a /tmp lease that
clears the flag if this process stops touching it.

This plugin does not wrap the stock screensaver, and it does not write another
plugin's settings or Moon+ Reader data. Runtime state stays in memory.
Persisted keys use the dashboard_ prefix only.
]]

local Blitbuffer = require("ffi/blitbuffer")
local ButtonDialog = require("ui/widget/buttondialog")
local CenterContainer = require("ui/widget/container/centercontainer")
local ConfirmBox = require("ui/widget/confirmbox")
local Device = require("device")
local Event = require("ui/event")
local Font = require("ui/font")
local FrameContainer = require("ui/widget/container/framecontainer")
local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local ImageWidget = require("ui/widget/imagewidget")
local InfoMessage = require("ui/widget/infomessage")
local InputContainer = require("ui/widget/container/inputcontainer")
local InputDialog = require("ui/widget/inputdialog")
local PluginShare = require("pluginshare")
local SpinWidget = require("ui/widget/spinwidget")
local TextWidget = require("ui/widget/textwidget")
local UIManager = require("ui/uimanager")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local logger = require("logger")
local protocol = require("protocol")
local _ = require("gettext")
local Screen = Device.screen
local lfs = require("libs/libkoreader-lfs")

local WEEKDAYS = { "星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六" }
local FULL_REFRESH_EVERY = 10

local function commandOk(cmd)
    local result = os.execute(cmd)
    return result == 0 or result == true
end

local function readExact(client, length)
    local parts = {}
    local left = length
    while left > 0 do
        local data, _, partial = client:receive(left)
        local chunk = data or partial
        if chunk and #chunk > 0 then
            parts[#parts + 1] = chunk
            left = left - #chunk
        end
        if not data then
            return nil
        end
    end
    return table.concat(parts)
end

local function batteryText()
    local ok, text = pcall(function()
        local powerd = Device:getPowerDevice()
        if not powerd or not powerd.getCapacity then
            return "电量未知"
        end
        local capacity = powerd:getCapacity()
        if type(capacity) ~= "number" then
            return "电量未知"
        end
        local charging = powerd.isCharging and powerd:isCharging()
        if charging then
            return string.format("电量 %d%% · 充电中", capacity)
        end
        return string.format("电量 %d%%", capacity)
    end)
    if ok and text then
        return text
    end
    return "电量未知"
end

local function clockParts()
    local now = os.date("*t")
    return {
        minute = string.format("%04d%02d%02d%02d%02d", now.year, now.month, now.day, now.hour, now.min),
        clock = string.format("%02d:%02d", now.hour, now.min),
        date = string.format("%d年%d月%d日 %s", now.year, now.month, now.day, WEEKDAYS[now.wday] or ""),
    }
end

local DashboardWidget = InputContainer:extend{
    name = "dashboard_widget",
    covers_fullscreen = true,
    poll_seconds = 3,
    mode = "placeholder",
    image_updates = 0,
    closed = false,
}

function DashboardWidget:init()
    self.width = Screen:getWidth()
    self.height = Screen:getHeight()
    self.dimen = Geom:new{ x = 0, y = 0, w = self.width, h = self.height }
    local range = Geom:new{ x = 0, y = 0, w = self.width, h = self.height }
    self.ges_events = {
        Tap = { GestureRange:new{ ges = "tap", range = range } },
        Swipe = { GestureRange:new{ ges = "swipe", range = range } },
        MultiSwipe = { GestureRange:new{ ges = "multiswipe", range = range } },
    }
    if Device:hasKeys() and Device.input and Device.input.group and Device.input.group.Back then
        self.key_events = {
            Close = { { Device.input.group.Back } },
        }
    end
    self.tick_action = function()
        self:_tick()
    end
    self:showPlaceholder()
    UIManager:scheduleIn(self.poll_seconds, self.tick_action)
end

function DashboardWidget:_tick()
    if self.closed then
        return
    end
    self.plugin:onTick(self)
    if not self.closed then
        UIManager:scheduleIn(self.poll_seconds, self.tick_action)
    end
end

function DashboardWidget:_replace(child, refresh)
    if self[1] then
        self[1]:free()
        self[1] = nil
    end
    self[1] = child
    UIManager:setDirty(self, refresh or "partial")
end

function DashboardWidget:showPlaceholder()
    local parts = clockParts()
    local info = self.plugin:statusLines()
    self.mode = "placeholder"
    self.minute = parts.minute
    self.address = info.address
    self.last_mtime = nil
    local face_clock = Font:getFace("cfont", Screen:scaleBySize(64))
    local face = Font:getFace("cfont", Screen:scaleBySize(24))
    local face_small = Font:getFace("cfont", Screen:scaleBySize(20))
    local function line(text, face_obj)
        return TextWidget:new{ text = text, face = face_obj, max_width = self.width - Screen:scaleBySize(48) }
    end
    self:_replace(FrameContainer:new{
        width = self.width,
        height = self.height,
        background = Blitbuffer.COLOR_WHITE,
        bordersize = 0,
        padding = 0,
        margin = 0,
        CenterContainer:new{
            dimen = Geom:new{ w = self.width, h = self.height },
            VerticalGroup:new{
                align = "center",
                line(parts.clock, face_clock),
                VerticalSpan:new{ width = Screen:scaleBySize(16) },
                line(parts.date, face),
                VerticalSpan:new{ width = Screen:scaleBySize(12) },
                line(batteryText(), face),
                VerticalSpan:new{ width = Screen:scaleBySize(28) },
                line("等待电脑推送…", face),
                VerticalSpan:new{ width = Screen:scaleBySize(16) },
                line(info.address, face_small),
                VerticalSpan:new{ width = Screen:scaleBySize(8) },
                line("口令", face_small),
                line(info.token, face_small),
                VerticalSpan:new{ width = Screen:scaleBySize(16) },
                line(info.note, face_small),
                VerticalSpan:new{ width = Screen:scaleBySize(8) },
                line("点按或返回手势退出", face_small),
            },
        },
    }, "full")
end

function DashboardWidget:showImage(mtime, force_full)
    local widget
    local ok = pcall(function()
        widget = ImageWidget:new{
            file = protocol.IMAGE_PATH,
            file_do_cache = false,
            width = self.width,
            height = self.height,
            scale_factor = 0,
        }
        widget:getSize()
    end)
    if not ok or not widget then
        if widget and widget.free then
            widget:free()
        end
        self:showPlaceholder()
        return false
    end
    self.image_updates = self.image_updates + 1
    local full = force_full or self.image_updates == 1 or self.image_updates % FULL_REFRESH_EVERY == 0
    self.mode = "image"
    self.last_mtime = mtime
    self:_replace(FrameContainer:new{
        width = self.width,
        height = self.height,
        background = Blitbuffer.COLOR_WHITE,
        bordersize = 0,
        padding = 0,
        margin = 0,
        CenterContainer:new{
            dimen = Geom:new{ w = self.width, h = self.height },
            widget,
        },
    }, full and "full" or "partial")
    return true
end

function DashboardWidget:onTap()
    self.plugin:close()
    return true
end

function DashboardWidget:onSwipe()
    return self:onTap()
end

function DashboardWidget:onMultiSwipe()
    return self:onTap()
end

function DashboardWidget:onClose()
    return self:onTap()
end

function DashboardWidget:onCloseWidget()
    self.closed = true
    if self.tick_action then
        UIManager:unschedule(self.tick_action)
    end
end

local Dashboard = WidgetContainer:extend{
    name = "dashboard",
    is_doc_only = false,
}

function Dashboard:init()
    self.ui.menu:registerToMainMenu(self)
end

function Dashboard:addToMainMenu(menu_items)
    menu_items.dashboard = {
        text = _("看板模式"),
        sorting_hint = "more_tools",
        callback = function()
            self:open()
        end,
        hold_callback = function()
            self:showSettings()
        end,
    }
end

function Dashboard:port()
    local value = tonumber(G_reader_settings:readSetting("dashboard_port"))
    if not value or value ~= math.floor(value) or value < 1024 or value > 65535 then
        return protocol.DEFAULT_PORT
    end
    return value
end

function Dashboard:pollSeconds()
    local value = tonumber(G_reader_settings:readSetting("dashboard_poll_interval"))
    if not value or value ~= math.floor(value) or value < 2 or value > 60 then
        return 3
    end
    return value
end

function Dashboard:_ensureToken()
    local token = G_reader_settings:readSetting("dashboard_token")
    if type(token) == "string" and token:match("^%x+$") and #token >= 16 then
        return token
    end
    local generated
    local random = io.open("/dev/urandom", "rb")
    if random then
        generated = protocol.randomToken(random:read(16) or "")
        random:close()
    end
    if not generated then
        math.randomseed(os.time() % 2147483647)
        local bytes = {}
        for i = 1, 16 do
            bytes[i] = string.char(math.random(0, 255))
        end
        generated = protocol.randomToken(table.concat(bytes))
    end
    G_reader_settings:saveSetting("dashboard_token", generated)
    G_reader_settings:flush()
    return generated
end

function Dashboard:token()
    return self:_ensureToken()
end

function Dashboard:_localIp()
    local ok, socket = pcall(require, "socket")
    if not ok or not socket or not socket.udp then
        return nil
    end
    local udp = socket.udp()
    if not udp then
        return nil
    end
    udp:settimeout(1)
    local peer_ok = udp:setpeername("203.0.113.1", 53)
    if not peer_ok then
        udp:close()
        return nil
    end
    local ip = udp:getsockname()
    udp:close()
    if type(ip) ~= "string" or ip == "" or ip == "0.0.0.0" then
        return nil
    end
    return ip
end

function Dashboard:statusLines()
    local ip = self:_localIp()
    local note = "屏幕保持点亮，耗电增加，请保持供电"
    if self.server_error then
        note = "HTTP 未启动：" .. self.server_error
    elseif not ip then
        note = "未获取到 IP，请先连接 Wi-Fi"
    end
    return {
        address = (ip or "未获取到 IP") .. ":" .. tostring(self:port()),
        token = self:token(),
        note = note,
    }
end

function Dashboard:_imageMtime()
    local ok, mtime = pcall(lfs.attributes, protocol.IMAGE_PATH, "modification")
    if ok then
        return mtime
    end
    return nil
end

function Dashboard:_lipc(value)
    if not Device:isKindle() then
        return
    end
    commandOk(string.format(
        "lipc-set-prop com.lab126.powerd preventScreenSaver %d >/dev/null 2>&1",
        value == 1 and 1 or 0))
end

function Dashboard:_touchLease()
    if not self._watchdog then
        return
    end
    local file = io.open(protocol.LEASE_PATH, "wb")
    if not file then
        return
    end
    file:write(tostring(os.time()))
    file:close()
end

function Dashboard:_startWatchdog()
    if self._watchdog or not Device:isKindle() then
        return
    end
    local file = io.open(protocol.WATCHDOG_SH, "wb")
    if not file then
        return
    end
    file:write(protocol.watchdogScript())
    file:close()
    commandOk("chmod 700 " .. protocol.WATCHDOG_SH)
    self._watchdog = true
    self:_touchLease()
    local starter = "setsid"
    if not commandOk("command -v setsid >/dev/null 2>&1") then
        starter = "nohup"
    end
    commandOk(starter .. " /bin/sh " .. protocol.WATCHDOG_SH .. " </dev/null >/dev/null 2>&1 & echo $! > " .. protocol.WATCHDOG_PID)
end

function Dashboard:_stopWatchdog()
    if not self._watchdog then
        return
    end
    self._watchdog = false
    local file = io.open(protocol.WATCHDOG_PID, "rb")
    if file then
        local pid = file:read("*l")
        file:close()
        if pid and pid:match("^%d+$") then
            commandOk("kill " .. pid .. " >/dev/null 2>&1")
        end
    end
    os.remove(protocol.WATCHDOG_PID)
    os.remove(protocol.LEASE_PATH)
    os.remove(protocol.WATCHDOG_SH)
end

function Dashboard:_arm()
    if self.holding then
        return
    end
    self.holding = true
    self._saved_pause = PluginShare.pause_auto_suspend
    self._saved_keepalive = PluginShare.keepalive
    -- pause_auto_suspend is what keepalive uses on Kobo. On Kindle, keepalive
    -- itself only sets preventScreenSaver; we also pause autosuspend so it does
    -- not call suspend while powerd is ignoring the power button.
    PluginShare.pause_auto_suspend = true
    PluginShare.keepalive = true
    UIManager:preventStandby()
    self._standby = true
    if Device:isKindle() then
        self:_lipc(1)
        self._lipc_on = true
        -- If the built-in Keep alive plugin already owns the flag, don't start a
        -- watchdog that would clear it, and don't clear it when we close.
        if not self._saved_keepalive then
            self:_startWatchdog()
            self._lipc_owned = true
        end
    end
end

function Dashboard:_release()
    if not self.holding then
        return
    end
    self:_stopWatchdog()
    if self._lipc_on and self._lipc_owned then
        self:_lipc(0)
    end
    self._lipc_on = false
    self._lipc_owned = false
    if self._standby then
        UIManager:allowStandby()
        self._standby = false
    end
    PluginShare.keepalive = self._saved_keepalive
    PluginShare.pause_auto_suspend = self._saved_pause
    self.holding = false
end

function Dashboard:_firewall(action, port)
    if not Device:isKindle() then
        return
    end
    commandOk(string.format(
        "iptables %s INPUT -p tcp --dport %d -m conntrack --ctstate NEW,ESTABLISHED -j ACCEPT",
        action, port))
    commandOk(string.format(
        "iptables %s OUTPUT -p tcp --sport %d -m conntrack --ctstate ESTABLISHED -j ACCEPT",
        action, port))
end

function Dashboard:_respond(client, code, body)
    local reasons = {
        [200] = "OK",
        [400] = "Bad Request",
        [401] = "Unauthorized",
        [404] = "Not Found",
        [405] = "Method Not Allowed",
        [411] = "Length Required",
        [413] = "Payload Too Large",
        [415] = "Unsupported Media Type",
        [500] = "Internal Server Error",
    }
    local payload = body or ""
    local response = table.concat({
        string.format("HTTP/1.0 %d %s", code, reasons[code] or "Error"),
        "Content-Type: application/json",
        "Content-Length: " .. tostring(#payload),
        "Connection: close",
        "",
        payload,
    }, "\r\n")
    if self.http_socket then
        self.http_socket:send(response, client)
    else
        pcall(function() client:close() end)
    end
    return Event:new("InputEvent")
end

function Dashboard:_statusJson()
    local width, height, rotation = 0, 0, 0
    pcall(function()
        width = Screen:getWidth()
        height = Screen:getHeight()
        if Screen.getRotationMode then
            rotation = Screen:getRotationMode() or 0
        end
    end)
    local orientation = width > height and "landscape" or "portrait"
    return string.format(
        '{"ok":true,"version":"%s","width":%d,"height":%d,"orientation":"%s","rotation":%d}',
        protocol.VERSION, width, height, orientation, rotation)
end

function Dashboard:_authorized(headers)
    local provided = protocol.bearerToken(headers["authorization"] or "")
    return protocol.tokensMatch(self:token(), provided)
end

function Dashboard:_handleRequest(data, client)
    local request = protocol.parseRequestHead(data)
    if not request then
        return self:_respond(client, 400, '{"ok":false,"error":"bad_request"}')
    end
    if request.path == "/status" and request.method == "GET" then
        if not self:_authorized(request.headers) then
            return self:_respond(client, 401, '{"ok":false,"error":"unauthorized"}')
        end
        return self:_respond(client, 200, self:_statusJson())
    end
    if request.path ~= "/dashboard.png" then
        return self:_respond(client, 404, '{"ok":false,"error":"not_found"}')
    end
    if request.method ~= "PUT" and request.method ~= "POST" then
        return self:_respond(client, 405, '{"ok":false,"error":"method"}')
    end
    if not self:_authorized(request.headers) then
        return self:_respond(client, 401, '{"ok":false,"error":"unauthorized"}')
    end
    local length = protocol.parseContentLength(request.headers["content-length"])
    if not length then
        return self:_respond(client, 411, '{"ok":false,"error":"length_required"}')
    end
    if length < 8 then
        return self:_respond(client, 400, '{"ok":false,"error":"too_small"}')
    end
    if length > protocol.MAX_PNG_BYTES then
        return self:_respond(client, 413, '{"ok":false,"error":"too_large"}')
    end
    client:settimeout(10)
    local body = readExact(client, length)
    if not body or not protocol.isPng(body) then
        return self:_respond(client, 415, '{"ok":false,"error":"not_png"}')
    end
    local saved, err = self:_writeImage(body)
    if not saved then
        logger.warn("dashboard: failed to store png", err)
        return self:_respond(client, 500, '{"ok":false,"error":"store_failed"}')
    end
    if self.widget and not self.widget.closed then
        self.widget:showImage(self:_imageMtime(), false)
    end
    self:_touchLease()
    return self:_respond(client, 200, '{"ok":true}')
end

function Dashboard:_writeImage(body)
    local file, err = io.open(protocol.TEMP_PATH, "wb")
    if not file then
        return nil, err
    end
    local written = file:write(body)
    file:close()
    if not written then
        os.remove(protocol.TEMP_PATH)
        return nil, "write"
    end
    local renamed, rename_err = os.rename(protocol.TEMP_PATH, protocol.IMAGE_PATH)
    if not renamed then
        os.remove(protocol.IMAGE_PATH)
        renamed, rename_err = os.rename(protocol.TEMP_PATH, protocol.IMAGE_PATH)
    end
    if not renamed then
        os.remove(protocol.TEMP_PATH)
        return nil, rename_err
    end
    return true
end

function Dashboard:onRequest(data, client)
    client:settimeout(10)
    local ok, result = pcall(function()
        return self:_handleRequest(data, client)
    end)
    if not ok then
        logger.warn("dashboard: request failed")
        return self:_respond(client, 500, '{"ok":false,"error":"internal"}')
    end
    return result
end

function Dashboard:_startServer()
    if self.http_socket then
        return true
    end
    local port = self:port()
    self:_firewall("-A", port)
    self.firewall_port = Device:isKindle() and port or nil
    local Server = require("ui/message/simpletcpserver")
    local server = Server:new{
        host = "*",
        port = port,
        receiveCallback = function(data, id)
            return self:onRequest(data, id)
        end,
    }
    local ok, err = server:start()
    if not ok then
        self:_closeFirewall()
        self.server_error = tostring(err or "bind failed")
        logger.warn("dashboard: server did not start", self.server_error)
        return false, self.server_error
    end
    self.http_socket = server
    self.http_queue = UIManager:insertZMQ(server)
    self.server_error = nil
    logger.dbg("dashboard: listening", port)
    return true
end

function Dashboard:_closeFirewall()
    if not self.firewall_port then
        return
    end
    local port = self.firewall_port
    self.firewall_port = nil
    self:_firewall("-D", port)
end

function Dashboard:_stopServer()
    local server = self.http_socket
    self.http_socket = nil
    if server then
        pcall(function() server:stop() end)
    end
    if self.http_queue then
        UIManager:removeZMQ(self.http_queue)
        self.http_queue = nil
    end
    self:_closeFirewall()
end

function Dashboard:open()
    if self.widget then
        return
    end
    self.suspended = false
    self.block_rearm = false
    self.resume_pending = false
    self:_ensureToken()
    self:_arm()
    self:_startServer()
    self.widget = DashboardWidget:new{
        plugin = self,
        poll_seconds = self:pollSeconds(),
    }
    UIManager:show(self.widget, "full")
end

function Dashboard:close()
    if self._closing then
        return
    end
    self._closing = true
    self:_stopServer()
    local widget = self.widget
    self.widget = nil
    if widget then
        widget.closed = true
        if widget.tick_action then
            UIManager:unschedule(widget.tick_action)
        end
        UIManager:close(widget, "full")
    end
    self:_release()
    self.suspended = false
    self.resume_pending = false
    self.block_rearm = false
    self._closing = false
end

function Dashboard:onTick(widget)
    if widget.closed then
        return
    end
    if self.suspended or (self.block_rearm and not self.resume_pending) then
        return
    end
    if self.resume_pending then
        self.resume_pending = false
        self.block_rearm = false
        self:_arm()
        self:_startServer()
        widget:showPlaceholder()
        local mtime = self:_imageMtime()
        if mtime then
            widget:showImage(mtime, true)
        end
        self:_touchLease()
        return
    end
    self:_touchLease()
    local mtime = self:_imageMtime()
    if mtime then
        if mtime ~= widget.last_mtime or widget.mode ~= "image" then
            widget:showImage(mtime, false)
        end
        return
    end
    local parts = clockParts()
    local address = self:statusLines().address
    if widget.mode ~= "placeholder" or widget.minute ~= parts.minute or widget.address ~= address then
        widget:showPlaceholder()
    end
end

function Dashboard:onSuspend()
    if not self.widget then
        return
    end
    self.suspended = true
    self.block_rearm = true
    self:_stopServer()
    self:_release()
end

function Dashboard:onResume()
    if not self.widget then
        return
    end
    self.suspended = false
    self.block_rearm = false
    self.resume_pending = true
end

function Dashboard:onFlushSettings()
    -- Also runs just before suspend, and on KOReader exit (SaveState).
    -- Suspend follows with onSuspend; exit does not resume, so stay released.
    if not self.widget then
        return
    end
    self.block_rearm = true
    self:_stopServer()
    self:_release()
end

function Dashboard:onSetDimensions()
    if self.widget and not self.suspended then
        self.block_rearm = false
        self.resume_pending = true
        self.widget.width = Screen:getWidth()
        self.widget.height = Screen:getHeight()
    end
end

function Dashboard:onExit()
    self:close()
end

function Dashboard:onCloseWidget()
    self:close()
end

function Dashboard:showSettings()
    local dialog
    dialog = ButtonDialog:new{
        title = _("看板连接"),
        title_align = "center",
        buttons = {
            {{
                text = _("端口 ") .. tostring(self:port()),
                callback = function()
                    UIManager:close(dialog)
                    self:editPort()
                end,
            }},
            {{
                text = _("检查间隔 ") .. tostring(self:pollSeconds()) .. _(" 秒"),
                callback = function()
                    UIManager:close(dialog)
                    self:editPoll()
                end,
            }},
            {{
                text = _("重新生成配对口令"),
                callback = function()
                    UIManager:close(dialog)
                    self:confirmRegenerate()
                end,
            }},
            {{
                text = _("关闭"),
                callback = function()
                    UIManager:close(dialog)
                end,
            }},
        },
    }
    UIManager:show(dialog)
end

function Dashboard:editPort()
    local dialog
    dialog = InputDialog:new{
        title = _("看板端口"),
        input = tostring(self:port()),
        input_type = "number",
        input_hint = _("1024–65535，默认 8686"),
        buttons = {{
            {
                text = _("取消"),
                id = "close",
                callback = function()
                    UIManager:close(dialog)
                end,
            },
            {
                text = _("确定"),
                callback = function()
                    local value = tonumber(dialog:getInputValue())
                    if value and value == math.floor(value) and value >= 1024 and value <= 65535 then
                        G_reader_settings:saveSetting("dashboard_port", value)
                        if self.widget then
                            self:_stopServer()
                            self:_startServer()
                            if self.widget.mode == "placeholder" then
                                self.widget:showPlaceholder()
                            end
                        end
                    else
                        UIManager:show(InfoMessage:new{ text = _("端口需在 1024 到 65535 之间"), timeout = 3 })
                    end
                    UIManager:close(dialog)
                end,
            },
        }},
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function Dashboard:editPoll()
    UIManager:show(SpinWidget:new{
        title_text = _("检查图片间隔（秒）"),
        info_text = _("打开看板后，按这个间隔查看图片是否更新。"),
        value = self:pollSeconds(),
        value_min = 2,
        value_max = 60,
        value_step = 1,
        default_value = 3,
        callback = function(spin)
            G_reader_settings:saveSetting("dashboard_poll_interval", spin.value)
            if self.widget then
                self.widget.poll_seconds = spin.value
            end
        end,
    })
end

function Dashboard:confirmRegenerate()
    UIManager:show(ConfirmBox:new{
        text = _("重新生成后，电脑里保存的旧口令会失效。"),
        ok_text = _("重新生成"),
        ok_callback = function()
            if G_reader_settings.delSetting then
                G_reader_settings:delSetting("dashboard_token")
            else
                G_reader_settings:saveSetting("dashboard_token", nil)
            end
            self:_ensureToken()
            if self.widget and self.widget.mode == "placeholder" then
                self.widget:showPlaceholder()
            end
        end,
    })
end

return Dashboard
