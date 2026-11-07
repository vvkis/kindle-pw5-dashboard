const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN = path.join(ROOT, 'kindle-plugin', 'dashboard.koplugin');

function run(bin, args) {
  return spawnSync(bin, args, {encoding: 'utf8', cwd: ROOT});
}

function findBin(names) {
  for (const name of names) {
    const result = run(name, ['-v']);
    if (!result.error) return name;
  }
  return null;
}

test('dashboard plugin Lua parses and the protocol checks pass', () => {
  const sources = ['_meta.lua', 'protocol.lua', 'main.lua'].map(name => path.join(PLUGIN, name));
  for (const file of sources) assert.equal(fs.existsSync(file), true, file);
  const luac = findBin(['luac5.1', 'luac']);
  assert.ok(luac, 'luac is required to syntax-check the KOReader plugin');
  for (const file of sources) {
    const parsed = run(luac, ['-p', file]);
    assert.equal(parsed.status, 0, parsed.stderr || parsed.stdout);
  }
  const lua = findBin(['lua5.1', 'lua']);
  assert.ok(lua, 'lua is required to run dashboard protocol checks');
  const checks = run(lua, [path.join('tests', 'dashboard_plugin.lua')]);
  assert.equal(checks.status, 0, checks.stderr || checks.stdout);
  assert.match(checks.stdout, /dashboard protocol ok/);
});

test('plugin source stays away from screensaver, book settings, and .moon', () => {
  const source = fs.readFileSync(path.join(PLUGIN, 'main.lua'), 'utf8')
    + fs.readFileSync(path.join(PLUGIN, 'protocol.lua'), 'utf8');
  assert.doesNotMatch(source, /require\(["']ui\/screensaver/);
  assert.doesNotMatch(source, /Screensaver\.setup/);
  assert.doesNotMatch(source, /screensaver_/);
  assert.doesNotMatch(source, /book_/);
  assert.doesNotMatch(source, /\.moon/);
  assert.match(source, /dashboard_token/);
  assert.match(source, /dashboard_port/);
  assert.match(source, /dashboard_poll_interval/);
  assert.match(source, /dashboard_show_connection_info/);
  assert.match(source, /连接信息/);
  assert.match(source, /sorting_hint = "main"/);
  assert.match(source, /reader_menu_order/);
  assert.match(source, /filemanager_menu_order/);
  assert.doesNotMatch(source, /sorting_hint = "tools"/);
  assert.doesNotMatch(source, /sorting_hint = "more_tools"/);
  assert.doesNotMatch(source, /menu_items\.dashboard_connection/);
  assert.match(source, /SAFE_MARGIN = 48/);
  assert.match(source, /dashboard_open/);
  assert.match(source, /OpenDashboard/);
  assert.match(source, /preventStandby/);
  assert.match(source, /allowStandby/);
  assert.match(source, /pause_auto_suspend/);
  assert.match(source, /simpletcpserver/);
  assert.match(source, /\/dashboard\.png/);
  assert.match(source, /\/status/);
});
