/* 蓝虎听歌 · 一键发布（AGENTS.md 定义的 sync:all 流程）
 *
 * 用法：npm run sync:all -- "提交信息"（缺省用日期自动生成）
 * 步骤：1) npm run check（lint + 语法 + 单元测试 + 构建检查）
 *       2) npx cap sync android（同步 Android 薄壳，本地生效；android/ 不入库）
 *       3) git add -A && git commit && git push origin main（推送后 GitHub Actions 自动部署网页版）
 * 任一环节失败即退出非零，不会继续后续步骤。
 */
'use strict';

const { execSync } = require('child_process');

function run(cmd, step){
  console.log('\n[step ' + step + '] ' + cmd);
  execSync(cmd, { stdio: 'inherit', cwd: __dirname + '/..' });
}

const msg = process.argv[2] || ('update: 蓝虎听歌 功能更新 ' + new Date().toISOString().slice(0, 10));

try {
  run('npm run check', '1/4 全量校验');
  run('npx cap sync android', '2/4 同步 Android');
  run('git add -A', '3/4 暂存全部改动');
  console.log('\n[step 4/4] git commit & push');
  execSync('git commit -m "' + msg.replace(/"/g, "'") + '"', { stdio: 'inherit', cwd: __dirname + '/..' });
  execSync('git push origin main', { stdio: 'inherit', cwd: __dirname + '/..' });
  console.log('\nsync:all 完成：已推送 main，等待 GitHub Actions 部署网页版。');
} catch (e){
  console.error('\nsync:all 失败：' + (e && e.message ? e.message : e));
  process.exit(1);
}
