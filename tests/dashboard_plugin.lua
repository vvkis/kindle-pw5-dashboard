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

print("dashboard protocol ok")
