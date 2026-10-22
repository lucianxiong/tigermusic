/* Build / integrity check for the static app.
   Modes:
     node tools/build-check.js syntax   -> parse every JS + JSON (typecheck gate)
     node tools/build-check.js full     -> syntax + asset references + secret scan
   Default: full. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'app');
const mode = process.argv[2] || 'full';
let failures = 0;
function fail(msg){ failures++; console.error('  FAIL ' + msg); }
function ok(msg){ console.log('  ok   ' + msg); }

function walk(dir, pred){
  let out = [];
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function(de){
    const p = path.join(dir, de.name);
    if (de.isDirectory()){
      if (de.name === 'node_modules' || de.name === 'dist' || de.name === 'android' || de.name === 'audits') return;
      out = out.concat(walk(p, pred));
    } else if (pred(p)) out.push(p);
  });
  return out;
}

/* 1. JS syntax via node --check */
console.log('[syntax] node --check');
const jsFiles = [
  ...walk(APP, p => p.endsWith('.js')),
  ...walk(path.join(ROOT, 'electron'), p => p.endsWith('.js')),
  ...walk(path.join(ROOT, 'tools'), p => p.endsWith('.js'))
];
jsFiles.forEach(function(f){
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e){
    fail('syntax ' + path.relative(ROOT, f) + ' :: ' + (e.stderr ? e.stderr.toString().split('\n')[0] : e.message));
  }
});
ok(jsFiles.length + ' JS files parse');

/* 2. JSON parse */
console.log('[json]');
['package.json', 'package-lock.json', 'app/manifest.webmanifest'].forEach(function(rel){
  const f = path.join(ROOT, rel);
  try { JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e){ fail('JSON ' + rel + ' :: ' + e.message); }
});
ok('JSON files parse');

if (mode === 'syntax'){
  if (failures){ console.error('\nSYNTAX GATE FAILED (' + failures + ')'); process.exit(1); }
  console.log('\nSYNTAX GATE PASSED');
  process.exit(0);
}

/* 3. index.html references exist */
console.log('[references]');
const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const refs = [];
let m;
const reSrc = /(?:src|href)="([^"]+)"/g;
while ((m = reSrc.exec(html))){
  const u = m[1];
  if (/^https?:/.test(u) || u.startsWith('#') || u.startsWith('data:')) continue;
  refs.push(u.split('?')[0]);
}
refs.forEach(function(r){
  if (!fs.existsSync(path.join(APP, r))){
    fail('missing asset referenced by index.html: ' + r);
  }
});
ok(refs.length + ' local references resolve');

/* manifest icons */
try {
  const man = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.webmanifest'), 'utf8'));
  (man.icons || []).forEach(function(ic){
    if (!fs.existsSync(path.join(APP, ic.src.split('?')[0]))) fail('missing manifest icon: ' + ic.src);
  });
} catch (e){ fail('manifest: ' + e.message); }

/* 4. Secret scan (safety net; secrets must never be committed) */
console.log('[secrets]');
const secretPatterns = [
  /sk-[A-Za-z0-9]{20,}/,                         // OpenAI-style
  /Bearer\s+[A-Za-z0-9._-]{20,}/,
  /api[_-]?key\s*[:=]\s*['"][A-Za-z0-9]{16,}['"]/i,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
  /ghp_[A-Za-z0-9]{30,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/
];
const scanFiles = [
  ...walk(APP, p => /\.(js|json|html|txt|webmanifest)$/.test(p)),
  ...walk(path.join(ROOT, 'tools'), p => /\.(js|json|html)$/.test(p)),
  ...walk(path.join(ROOT, 'electron'), p => p.endsWith('.js'))
];
let secretHits = 0;
scanFiles.forEach(function(f){
  const text = fs.readFileSync(f, 'utf8');
  secretPatterns.forEach(function(pat){
    if (pat.test(text)){ fail('possible secret in ' + path.relative(ROOT, f) + ' (' + pat.source.slice(0, 24) + ')'); secretHits++; }
  });
});
if (!secretHits) ok('no embedded secrets');

if (failures){ console.error('\nBUILD CHECK FAILED (' + failures + ')'); process.exit(1); }
console.log('\nBUILD CHECK PASSED');
