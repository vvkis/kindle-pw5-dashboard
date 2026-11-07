-- Pure helpers for the dashboard plugin. No KOReader imports, so the desktop tests can load this file.
local protocol = {}

protocol.VERSION = "1"
protocol.IMAGE_PATH = "/mnt/us/dashboard.png"
protocol.TEMP_PATH = "/mnt/us/.dashboard-upload.tmp"
protocol.LEASE_PATH = "/tmp/kdash.lease"
protocol.WATCHDOG_PID = "/tmp/kdash.watchdog.pid"
protocol.WATCHDOG_SH = "/tmp/kdash-watchdog.sh"
protocol.LEASE_SECONDS = 90
protocol.MAX_PNG_BYTES = 8 * 1024 * 1024
protocol.DEFAULT_PORT = 8686
protocol.PNG_MAGIC = "\137PNG\r\n\26\n"

function protocol.isPng(body)
    return type(body) == "string"
        and #body >= 8
        and #body <= protocol.MAX_PNG_BYTES
        and body:sub(1, 8) == protocol.PNG_MAGIC
end

function protocol.tokensMatch(expected, provided)
    if type(expected) ~= "string" or type(provided) ~= "string" then
        return false
    end
    if #expected == 0 or #expected ~= #provided then
        return false
    end
    local diff = 0
    for i = 1, #expected do
        if expected:byte(i) ~= provided:byte(i) then
            diff = diff + 1
        end
    end
    return diff == 0
end

function protocol.bearerToken(value)
    if type(value) ~= "string" then
        return nil
    end
    return value:match("^[Bb]earer%s+(%S+)$")
end

function protocol.parseContentLength(value)
    if type(value) ~= "string" or not value:match("^%d+$") then
        return nil
    end
    local length = tonumber(value)
    if not length or length < 0 or length % 1 ~= 0 then
        return nil
    end
    return length
end

-- Header block as assembled by KOReader's SimpleTCPServer (lines joined by CRLF, ending in a blank line).
function protocol.parseRequestHead(data)
    if type(data) ~= "string" or data == "" then
        return nil
    end
    local first, rest = data:match("^([^\r\n]+)\r?\n(.*)$")
    if not first then
        return nil
    end
    local method, target = first:match("^(%u+)%s+(%S+)%s+HTTP/%d%.%d$")
    if not method or not target then
        return nil
    end
    local path = target:match("^([^%?#]+)") or target
    local headers = {}
    for line in (rest or ""):gmatch("([^\r\n]*)\r?\n") do
        if line == "" then
            break
        end
        local key, value = line:match("^([^:%s]+)%s*:%s*(.*)$")
        if key then
            headers[key:lower()] = value
        end
    end
    return { method = method, path = path, headers = headers }
end

-- Nil means the user has never chosen, so the pairing strip stays visible.
function protocol.connectionInfoVisible(stored)
    if stored == nil then
        return true
    end
    return stored ~= false
end

-- Tap on the bottom strip toggles the overlay. Taps above it do not.
function protocol.overlayTap(screen_height, y, bar_height, shown)
    if not shown or type(y) ~= "number" or type(screen_height) ~= "number" or type(bar_height) ~= "number" then
        return false
    end
    if bar_height < 1 or y < 0 or y > screen_height then
        return false
    end
    return y >= screen_height - bar_height
end

-- Uppercase, no 0/O or 1/I, so the code can be read off the e-ink screen.
protocol.TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
protocol.TOKEN_LENGTH = 8

function protocol.isPairingToken(token)
    if type(token) ~= "string" or #token ~= protocol.TOKEN_LENGTH then
        return false
    end
    for i = 1, #token do
        if not protocol.TOKEN_ALPHABET:find(token:sub(i, i), 1, true) then
            return false
        end
    end
    return true
end

function protocol.randomToken(bytes)
    local alphabet = protocol.TOKEN_ALPHABET
    local size = #alphabet
    if type(bytes) ~= "string" or #bytes < protocol.TOKEN_LENGTH then
        return nil
    end
    local chars = {}
    for i = 1, protocol.TOKEN_LENGTH do
        local index = bytes:byte(i) % size + 1
        chars[i] = alphabet:sub(index, index)
    end
    return table.concat(chars)
end

function protocol.pointInBox(x, y, box)
    if type(x) ~= "number" or type(y) ~= "number" or type(box) ~= "table" then
        return false
    end
    if type(box.x) ~= "number" or type(box.y) ~= "number" or type(box.w) ~= "number" or type(box.h) ~= "number" then
        return false
    end
    return x >= box.x and y >= box.y and x < box.x + box.w and y < box.y + box.h
end

-- If this file is not touched for LEASE_SECONDS, clear preventScreenSaver and exit.
-- Only /tmp. A crash of KOReader therefore cannot leave the Kindle awake forever.
function protocol.watchdogScript()
    return [[#!/bin/sh
lease=/tmp/kdash.lease
limit=90
while true; do
  sleep 5
  if [ ! -f "$lease" ]; then
    lipc-set-prop com.lab126.powerd preventScreenSaver 0
    exit 0
  fi
  now=$(date +%s 2>/dev/null) || exit 0
  ts=$(cat "$lease" 2>/dev/null)
  case "$ts" in
    ""|*[!0-9]*)
      lipc-set-prop com.lab126.powerd preventScreenSaver 0
      exit 0
      ;;
  esac
  if [ $((now - ts)) -ge "$limit" ]; then
    lipc-set-prop com.lab126.powerd preventScreenSaver 0
    rm -f "$lease"
    exit 0
  fi
done
]]
end

return protocol
