/* 蓝虎听歌 · 一键发布（三端自动同步）
 *
 * 用法：npm run sync:all -- "提交信息"
 * 步骤：1) 读取 package.json 版本号，自动更新 README / app.js 下载链接
 *       2) npm run check（lint + 语法 + 单元测试 + 构建检查）
 *       3) npx cap sync android（同步 Android 薄壳）
 *       4) git add -A && git commit && git push origin main（触发网页版部署）
 *       5) 打 tag vX.Y.Z 并 push（触发 GitHub Actions 打包 Windows + Android）
 *       6) 云端 create-release 自动删除旧版本 Release，只保留最新
 * 任一环节失败即退出非零，不会继续后续步骤。
 */
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
function run(cmd, step){
  console.log('\n[step ' + step + '] ' + cmd);
  execSync(cmd, { stdio: 'inherit', cwd: root });
}

const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;
const tag = 'v' + version;
console.log('发布版本号：' + version + '  tag：' + tag);

// 1) 同步 README 与 app.js 中的下载链接
function syncLinks(file){
  if (!fs.existsSync(file)) return;
  let txt = fs.readFileSync(file, 'utf8');
  const before = txt;
  // 替换 releases/download/vX.Y.Z/ 前缀
  txt = txt.replace(/releases\/download\/v[\d.]+\//g, 'releases/download/' + tag + '/');
  // 替换文件名中的版本号
  txt = txt.replace(/Tiger-Music-v[\d.]+-(setup|portable)\.exe/g, 'Tiger-Music-' + tag + '-$1.exe');
  if (txt !== before) {
    fs.writeFileSync(file, txt, 'utf8');
    console.log('已同步链接：' + path.relative(root, file));
  } else {
    console.log('链接已是 ' + tag + '，跳过：' + path.relative(root, file));
  }
}
syncLinks(path.join(root, 'README.md'));
syncLinks(path.join(root, 'app', 'js', 'app.js'));

const msg = process.argv[2] || ('release: 蓝虎听歌 ' + tag + ' 三端同步 ' + new Date().toISOString().slice(0, 10));

try {
  run('npm run check', '1/5 全量校验');
  run('npx cap sync android', '2/5 同步 Android');
  run('git add -A', '3/5 暂存全部改动');
  console.log('\n[step 3.5/5] git commit');
  try { execSync('git commit -m "' + msg.replace(/"/g, "'") + '"', { stdio: 'inherit', cwd: root }); } catch(_e){ console.log('（无改动可提交）'); }
  console.log('\n[step 4/5] git push main');
  execSync('git push origin main', { stdio: 'inherit', cwd: root });

  console.log('\n[step 5/5] tag ' + tag + ' & push（触发云端打包）');
  try { execSync('git tag -d ' + tag, { stdio: 'ignore', cwd: root }); } catch(_e){}
  try { execSync('git push origin :refs/tags/' + tag, { stdio: 'ignore', cwd: root }); } catch(_e){}
  execSync('git tag -a ' + tag + ' -m "Release ' + tag + ' 三端自动同步"', { stdio: 'inherit', cwd: root });
  execSync('git push origin ' + tag, { stdio: 'inherit', cwd: root });

  console.log('\nsync:all 完成。');
  console.log('  - 网页版已推送 main（GitHub Actions 自动部署）');
  console.log('  - 已推送 tag ' + tag + '（云端打包 Windows + Android）');
  console.log('  - 打包完成后旧版 Release 会被自动清理，只保留 ' + tag);
} catch (e){
  console.error('\nsync:all 失败：' + (e && e.message ? e.message : e));
  process.exit(1);
}