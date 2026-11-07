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

local token = protocol.randomToken(string.char(0, 255, 16, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1))
eq(token, "00ff100a000000000000000000000001", "hex token")
eq(protocol.randomToken("short"), nil, "token needs 16 bytes")

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
