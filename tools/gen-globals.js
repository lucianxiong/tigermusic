/* Scans app/js for top-level (column-0) declarations and writes a shared
   globals map so ESLint understands the multi-file browser global scope.
   Run after adding/removing top-level data globals. */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'app', 'js');
const OUT = path.join(__dirname, 'app-globals.json');

const declRe = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const fnRe = /^function\s+([A-Za-z_$][\w$]*)/gm;

const names = new Set();
fs.readdirSync(DIR).filter(f => f.endsWith('.js')).forEach(function(f){
  const code = fs.readFileSync(path.join(DIR, f), 'utf8');
  let m;
  while ((m = declRe.exec(code))) names.add(m[1]);
  while ((m = fnRe.exec(code))) names.add(m[1]);
});

const globals = {};
[...names].sort().forEach(function(n){ globals[n] = 'writable'; });
fs.writeFileSync(OUT, JSON.stringify(globals, null, 2) + '\n');
console.log('wrote', Object.keys(globals).length, 'shared globals ->', OUT);
