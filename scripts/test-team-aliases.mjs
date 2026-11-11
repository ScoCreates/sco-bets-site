
import fs from 'node:fs';
import { normalizeTeamName } from '../lib/team-aliases.js';

const file = 'C:/sco-bets-diagnostics/NCAA/ncaa-team-alias-candidates.csv';

const lines = fs.readFileSync(file, 'utf8')
  .trim()
  .split(/\r?\n/)
  .slice(1);

let passed = 0;
const failed = [];

for (const line of lines) {
  const columns = [
    ...line.matchAll(/"((?:[^"]|"")*)"/g)
  ].map(match => match[1].replace(/""/g, '"'));

  if (columns.length < 2) continue;

  const [oddsName, espnName] = columns;

  if (
    normalizeTeamName(oddsName) ===
    normalizeTeamName(espnName)
  ) {
    passed++;
  } else {
    failed.push(`${oddsName} -> ${espnName}`);
  }
}

console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed.length}`);

if (failed.length > 0) {
  console.log('\nMappings needing attention:');
  failed.forEach(name => console.log(name));
}
