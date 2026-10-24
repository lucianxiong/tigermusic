#!/usr/bin/env node
/* 蓝虎 OS · 系列应用统一操作系统
 * 用法：npx tiger-os <command> [args]
 * 命令：init / status / doctor / install-hooks / bump / check / sync / release
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
function sh(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status || 1);
}
function pkg() { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')); }
function readIf(rel) { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return null; } }

function status() {
  const v = pkg().version;
  const tag = 'v' + v;
  console.log('\n[蓝虎 OS] 状态  v' + v + '\n');
  const checks = [
    ['package.json', 'package.json', /"version"\s*:\s*"([\d.]+)"/],
    ['app/js/version.js', 'app/js/version.js', /window\.TIGER_MUSIC_VERSION\s*=\s*"([\d.]+)"/],
    ['app/sw.js CACHE', 'app/sw.js', /bluetiger-music-(v[\d.]+)/],
    ['app/index.html ?v=', 'app/index.html', /\?v=([\d.]+)/],
    ['README.md 标题', 'README.md', /# 蓝虎听歌（Tiger Music）· (v[\d.]+)/],
    ['README.md 链接', 'README.md', /releases\/download\/(v[\d.]+)\//],
    ['app/js/app.js 链接', 'app/js/app.js', /releases\/download\/(v[\d.]+)\//]
  ];
  let allOk = true;
  checks.forEach(function(c){
    const label = c[0], rel = c[1], re = c[2];
    const t = readIf(rel);
    if (!t) { console.log('  [X] ' + label + ': 文件缺失'); allOk = false; return; }
    const m = t.match(re);
    if (!m) { console.log('  [X] ' + label + ': 未匹配'); allOk = false; return; }
    const got = m[1].charAt(0) === 'v' ? m[1] : 'v' + m[1];
    const ok = got === tag;
    console.log('  ' + (ok ? '[OK]' : '[X] ') + ' ' + label + ': ' + got);
    if (!ok) allOk = false;
  });
  console.log('');
  if (allOk) {
    console.log('  [PASS] 全端一致: ' + tag + '\n');
  } else {
    console.error('  [FAIL] 存在不一致，请运行: npx tiger-os bump ' + v + '\n');
    process.exit(1);
  }
}

function doctor() {
  console.log('\n[蓝虎 OS] 环境检查\n');
  [['node',['--version']],['npm',['--version']],['git',['--version']],['gh',['--version']],['java',['-version']]].forEach(function(c){
    const name = c[0], args = c[1];
    const r = spawnSync(name, args, { encoding: 'utf8', shell: true });
    if (r.status === 0 && (r.stdout || r.stderr)) {
      console.log('  [OK] ' + name + ': ' + (r.stdout || r.stderr).split('\n')[0]);
    } else {
      console.log('  [X]  ' + name + ': 未安装');
    }
  });
  console.log('\n  项目结构：');
  ['app/index.html','tools/tiger-os.js','tools/bump-version.js','tools/sync-all.js','.github/workflows/release.yml','AGENTS.md','BLUE-TIGER-OS.md'].forEach(function(f){
    console.log('  ' + (fs.existsSync(path.join(ROOT, f)) ? '[OK]' : '[X] ') + ' ' + f);
  });
  console.log('');
}

function init() {
  console.log('\n[蓝虎 OS] 初始化\n');
  const p = pkg();
  console.log('  项目名: ' + p.name);
  console.log('  版本: v' + p.version + '\n');
  const essential = [
    'tools/bump-version.js','tools/sync-all.js','tools/tiger-os.js',
    'tools/build-check.js','tools/gen-version.js','tools/gen-globals.js'
  ];
  const missing = essential.filter(function(f){ return !fs.existsSync(path.join(ROOT, f)); });
  if (missing.length) {
    console.log('  [!] 缺少核心文件：');
    missing.forEach(function(f){ console.log('     - ' + f); });
    console.log('\n  提示：从 tigermusic 项目复制 tools/ 目录后重试。\n');
    return;
  }
  console.log('  [OK] 所有核心文件齐全\n');
  console.log('  建议下一步:');
  console.log('    1. npx tiger-os install-hooks   安装 pre-commit 强拦截');
  console.log('    2. npx tiger-os status          查看版本一致性');
  console.log('    3. npx tiger-os doctor          检查构建环境\n');
}

function installHooks() {
  const hookDir = path.join(ROOT, '.git', 'hooks');
  if (!fs.existsSync(hookDir)) {
    console.error('未找到 .git/hooks，请先 git init');
    process.exit(1);
  }
  const hookPath = path.join(hookDir, 'pre-commit');
  const content = '#!/bin/sh\n' +
    '# 蓝虎 OS · pre-commit 强校验\n' +
    'node tools/bump-version.js --check || {\n' +
    '  echo ""\n' +
    '  echo "[X] 版本号不一致，提交已被拦截。"\n' +
    '  echo "   修复: npx tiger-os bump <current>"\n' +
    '  echo ""\n' +
    '  exit 1\n' +
    '}\n';
  fs.writeFileSync(hookPath, content, { mode: 0o755 });
  console.log('[OK] pre-commit hook 已安装: .git/hooks/pre-commit\n');
}

function bump(ver) {
  if (!ver || !/^\d+\.\d+\.\d+$/.test(ver)) {
    console.error('用法: npx tiger-os bump <x.y.z>');
    process.exit(1);
  }
  console.log('\n[蓝虎 OS] 升级至 v' + ver + '\n');
  const p = pkg();
  p.version = ver;
  const pkgPath = path.join(ROOT, 'package.json');
  fs.writeFileSync(pkgPath, JSON.stringify(p, null, 2) + '\n', 'utf8');
  console.log('  package.json version -> ' + ver + '\n');
  sh('node', ['tools/bump-version.js']);
  console.log('\n  [OK] 版本已升级至 v' + ver + '\n');
}

function check() { sh('npm', ['run', 'check']); }
function sync() { sh('npx', ['cap', 'sync', 'android']); }
function release() {
  const msg = process.argv.slice(3).join(' ');
  const args = ['tools/sync-all.js'];
  if (msg) args.push(msg);
  sh('node', args);
}

function help() {
  console.log('\n蓝虎 OS · 系列应用统一操作系统\n');
  console.log('用法: npx tiger-os <command> [args]\n');
  console.log('命令:');
  console.log('  init              初始化检查');
  console.log('  status            版本一致性面板');
  console.log('  doctor            环境检查');
  console.log('  install-hooks     安装 pre-commit 强拦截');
  console.log('  bump <version>    升级版本并同步');
  console.log('  check             全量校验');
  console.log('  sync              同步 Android');
  console.log('  release [msg]     一键发布\n');
  console.log('示例:');
  console.log('  npx tiger-os bump 1.6.0');
  console.log('  npx tiger-os release "feat: 新增"\n');
}

const map = {
  help: help, status: status, doctor: doctor, init: init,
  'install-hooks': installHooks,
  bump: bump, check: check, sync: sync, release: release
};
const cmd = process.argv[2] || 'help';
const fn = map[cmd] || help;
fn.apply(null, process.argv.slice(3));