package.path = "kindle-plugin/dashboard.koplugin/?.lua;" .. package.path
local protocol = require("protocol")

local function eq(actual, expected, message)
    if actual ~= expected then
        error((message or "assertion failed") .. "\n  actual: " .. tostring(actual) .. "\n  expected: " .. tostring(expected), 2)
    end
end

local png = protocol.PNG_MAGIC .. "rest-of-file"
eq(protocol.isPng(png), true, "png magic")
eq(protocol.isPng("GIF89a...."), false, "reject non-png")
eq(protocol.isPng(protocol.PNG_MAGIC), true, "header alone is still a png prefix of sufficient length")
eq(protocol.isPng(string.rep("A", protocol.MAX_PNG_BYTES + 1)), false, "oversize")

eq(protocol.tokensMatch("abcdef", "abcdef"), true, "token match")
eq(protocol.tokensMatch("abcdef", "abcdee"), false, "token mismatch")
eq(protocol.tokensMatch("abcdef", "abc"), false, "token length")
eq(protocol.tokensMatch("", "abc"), false, "empty token")
eq(protocol.bearerToken("Bearer secret-token"), "secret-token", "bearer")
eq(protocol.bearerToken("bearer secret-token"), "secret-token", "bearer case")
eq(protocol.bearerToken("Basic secret-token"), nil, "not bearer")

eq(protocol.parseContentLength("12"), 12, "length")
eq(protocol.parseContentLength("12kb"), nil, "length junk")
eq(protocol.parseContentLength("-1"), nil, "negative length")

local head = table.concat({
    "POST /dashboard.png?ignored=1 HTTP/1.1",
    "Host: 192.168.1.20:8686",
    "Authorization: Bearer abc",
    "Content-Length: 8",
    "Content-Type: image/png",
    "",
    "",
}, "\r\n")
local request = protocol.parseRequestHead(head)
eq(request.method, "POST", "method")
eq(request.path, "/dashboard.png", "path drops query")
eq(request.headers["authorization"], "Bearer abc", "auth header")
eq(request.headers["content-length"], "8", "content length header")
eq(protocol.parseRequestHead("GET /status HTTP/1.0\r\n\r\n").path, "/status", "status path")
eq(protocol.parseRequestHead("not http"), nil, "bad request")

eq(#protocol.TOKEN_ALPHABET, 32, "unbiased alphabet")
eq(protocol.TOKEN_ALPHABET:find("0", 1, true), nil, "no zero")
eq(protocol.TOKEN_ALPHABET:find("O", 1, true), nil, "no O")
eq(protocol.TOKEN_ALPHABET:find("1", 1, true), nil, "no one")
eq(protocol.TOKEN_ALPHABET:find("I", 1, true), nil, "no I")
eq(protocol.TOKEN_LENGTH, 8, "token length")
eq(protocol.isPairingToken("K7MP4Q2R"), true, "short token")
eq(protocol.isPairingToken("00ff100a000000000000000000000001"), false, "old hex token is replaced")
eq(protocol.isPairingToken("K7MP0Q2R"), false, "no zero")
eq(protocol.isPairingToken("K7MPOq2R"), false, "no O or lowercase")
local token = protocol.randomToken(string.char(0, 31, 32, 1, 10, 11, 12, 13))
eq(token, "A9ABLMNP", "mapped token")
eq(protocol.isPairingToken(token), true, "generated token is valid")
eq(protocol.randomToken("short"), nil, "token needs 8 bytes")
eq(protocol.pointInBox(10, 10, {x = 0, y = 0, w = 20, h = 20}), true, "inside regenerate")
eq(protocol.pointInBox(30, 10, {x = 0, y = 0, w = 20, h = 20}), false, "outside regenerate")

eq(protocol.connectionInfoVisible(nil), true, "connection strip defaults on")
eq(protocol.connectionInfoVisible(true), true, "connection strip stays on")
eq(protocol.connectionInfoVisible(false), false, "connection strip can be hidden")
eq(protocol.overlayTap(1648, 1600, 120, true), true, "tap on the strip")
eq(protocol.overlayTap(1648, 400, 120, true), false, "tap on the picture is not the strip")
eq(protocol.overlayTap(1648, 1600, 120, false), false, "hidden strip ignores taps")
eq(protocol.overlayTap(1648, nil, 120, true), false, "missing coordinate")

local script = protocol.watchdogScript()
eq(script:find("/tmp/kdash.lease", 1, true) ~= nil, true, "lease path")
eq(script:find("limit=90", 1, true) ~= nil, true, "lease window")
eq(script:find("preventScreenSaver 0", 1, true) ~= nil, true, "clears screensaver hold")
eq(script:find("preventScreenSaver 1", 1, true) ~= nil, false, "watchdog must not keep the screen awake")
eq(script:find("/mnt/us", 1, true) ~= nil, false, "watchdog stays out of userstore")
eq(script:find("init.d", 1, true) ~= nil, false, "no init script")
eq(protocol.IMAGE_PATH, "/mnt/us/dashboard.png", "image path")
eq(protocol.TEMP_PATH:sub(1, 8), "/mnt/us/", "temp stays on the same filesystem")

-- Load the real plugin with the KOReader UI and network dependencies stubbed.
local searchers = package.searchers or package.loaders
local widget = { extend = function(_, spec) return spec end, new = function(_, spec) return spec end }
table.insert(searchers, 1, function(name)
    if name:match("^ui/") or name == "device" or name == "ffi/blitbuffer"
        or name == "dispatcher" or name == "pluginshare" or name == "logger"
        or name == "libs/libkoreader-lfs" then
        return function() return widget end
    elseif name == "gettext" then
        return function() return function(text) return text end end
    end
end)
local wifi = { name = "wlan0", ipv4 = "192.168.43.25" }
local freed = 0
local shown
package.loaded["ui/uimanager"] = { show = function(_, spec) shown = spec end, close = function() end }
package.loaded["ui/network/manager"] = { getNetworkInterfaceName = function() return "wlan0" end }
package.loaded.device = {
    model = "KindleScribe",
    screen = {
        getWidth = function() return 2480 end,
        getHeight = function() return 1860 end,
        getRotationMode = function() return 1 end,
    },
}
package.loaded["ffi/netinfo"] = {
    new = function()
        return {
            retrieve = function() return { { name = "usb0", ipv4 = "192.168.15.244" }, wifi } end,
            free = function() freed = freed + 1 end,
        }
    end,
}
package.loaded.socket = {
    udp = function()
        return { settimeout = function() end, setpeername = function() return nil end, close = function() end }
    end,
}
local dashboard = require("main")
table.remove(searchers, 1)
eq(dashboard:_statusJson(), '{"ok":true,"version":"1","width":2480,"height":1860,"orientation":"landscape","rotation":1,"model":"KindleScribe"}', "report logical dimensions and model")
package.loaded.device.model = 'bad"model'
eq(dashboard:_statusJson():find('"model":""', 1, true) ~= nil, true, "ignore unsafe model IDs")
function dashboard:port() return 8686 end
function dashboard:pollSeconds() return 10 end
function dashboard:token() return "K7MP4Q2R" end
eq(dashboard:statusLines().address, "192.168.43.25:8686", "show the Wi-Fi IP even without a default route")
wifi.ipv4 = "10.0.0.26 / 10.0.0.27"
eq(dashboard:statusLines().address, "10.0.0.26:8686", "refresh after reconnect and show a single address")
wifi.ipv4 = nil
eq(dashboard:statusLines().address, "未获取到 IP:8686", "do not display the USB address when Wi-Fi has no IPv4")
eq(freed, 3, "free each network snapshot")
wifi.ipv4 = "192.168.43.25"
function dashboard:setShowConnectionInfo() end
function dashboard:open() end
dashboard:showSettings()
eq(shown.title, "看板连接\n192.168.43.25:8686", "show the address directly in the settings dialog")
shown.buttons[3][1].callback()
eq(shown.text:find("192.168.43.25:8686", 1, true) ~= nil, true, "connection dialog shows the address")
eq(shown.text:find("K7MP4Q2R", 1, true) ~= nil, true, "connection dialog shows the pairing token")

print("dashboard protocol ok")
