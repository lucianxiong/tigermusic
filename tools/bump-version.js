/* 强制版本号同步器
 * 唯一权威源：package.json 的 version
 * 目标：app/js/version.js, app/sw.js, app/index.html, README.md, app/js/app.js
 * 用法：node tools/bump-version.js [--check]
 *   --check：仅检查，不一致则退出码 1
 *   默认：强制覆写所有文件至 package.json 版本
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const v = pkg.version;
const tag = 'v' + v;
const checkOnly = process.argv.includes('--check');

let errors = [];

function updateFile(relPath, transformFn) {
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) return;
  const before = fs.readFileSync(abs, 'utf8');
  const after = transformFn(before);
  if (before !== after) {
    if (checkOnly) {
      errors.push('版本不一致: ' + relPath);
    } else {
      fs.writeFileSync(abs, after, 'utf8');
      console.log('已同步: ' + relPath);
    }
  }
}

// 1. app/js/version.js
updateFile('app/js/version.js', t => t.replace(/window\.TIGER_MUSIC_VERSION\s*=\s*"[\d.]+"/, 'window.TIGER_MUSIC_VERSION = "' + v + '"'));

// 2. app/sw.js
updateFile('app/sw.js', t => t.replace(/bluetiger-music-v[\d.]+/g, 'bluetiger-music-' + tag));

// 3. app/index.html (?v=X.Y.Z)
updateFile('app/index.html', t => t.replace(/\?v=[\d.]+/g, '?v=' + v));

// 4. README.md
updateFile('README.md', t => {
  t = t.replace(/(# 蓝虎听歌（Tiger Music）·\s*)v[\d.]+/g, '$1' + tag);
  t = t.replace(/releases\/download\/v[\d.]+\//g, 'releases/download/' + tag + '/');
  t = t.replace(/Tiger-Music-v[\d.]+-(setup|portable)\.exe/g, 'Tiger-Music-' + tag + '-$1.exe');
  return t;
});

// 5. app/js/app.js (下载链接)
updateFile('app/js/app.js', t => {
  t = t.replace(/releases\/download\/v[\d.]+\//g, 'releases/download/' + tag + '/');
  t = t.replace(/Tiger-Music-v[\d.]+-(setup|portable)\.exe/g, 'Tiger-Music-' + tag + '-$1.exe');
  return t;
});

if (checkOnly) {
  if (errors.length > 0) {
    console.error('\n[版本校验失败] 发现不一致：');
    errors.forEach(e => console.error('  - ' + e));
    console.error('请运行 npm run sync:version 强制同步。\n');
    process.exit(1);
  } else {
    console.log('[版本校验通过] 所有文件版本号均为 ' + tag);
  }
} else {
  console.log('[版本同步完成] 已强制覆写至 ' + tag);
}

