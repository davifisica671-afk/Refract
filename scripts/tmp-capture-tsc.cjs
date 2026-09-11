const { execFileSync } = require('child_process');
const fs = require('fs');
try {
  const out = execFileSync('npx', ['tsc','-p','electron/tsconfig.json','--noEmit','--pretty','false'], { encoding: 'utf8', maxBuffer: 10*1024*1024 });
  fs.writeFileSync('C:/Users/davif/refract/tsc-out.txt', 'OK\n' + out);
} catch (e) {
  const combined = (e.stdout || '') + '\n---STDERR---\n' + (e.stderr || '') + '\n---MSG---\n' + (e.message || '');
  fs.writeFileSync('C:/Users/davif/refract/tsc-out.txt', combined);
  console.log('wrote tsc-out.txt bytes=' + combined.length);
}
