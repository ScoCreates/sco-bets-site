
import fs from 'node:fs';
import { normalizeTeamName } from '../lib/team-aliases.js';

const lines = fs.readFileSync('C:/sco-bets-diagnostics/NCAA/ncaa-team-comparison.csv', 'utf8')
  .trim()
  .split(/\r?\n/);

const headers = [
  ...lines[0].matchAll(/"((?:[^"]|"")*)"/g)
].map(match => match[1].replace(/""/g, '"'));

const rows = lines.slice(1).map(line => {
  const values = [
    ...line.matchAll(/"((?:[^"]|"")*)"/g)
  ].map(match => match[1].replace(/""/g, '"'));

  return Object.fromEntries(
    headers.map((header, index) => [header, values[index] || ''])
  );
});

let matched = 0;
let reversed = 0;
const failed = [];

for (const row of rows) {
  const oddsAway = normalizeTeamName(row['Odds Away']);
  const oddsHome = normalizeTeamName(row['Odds Home']);
  const espnAway = normalizeTeamName(row['ESPN Away']);
  const espnHome = normalizeTeamName(row['ESPN Home']);

  const oddsTime = new Date(row['Odds Start UTC']).getTime();
  const espnTime = new Date(row['ESPN Start UTC']).getTime();

  const validTime =
    Number.isFinite(oddsTime) &&
    Number.isFinite(espnTime) &&
    Math.abs(oddsTime - espnTime) <= 3 * 60 * 60 * 1000;

  const normal =
    oddsAway === espnAway &&
    oddsHome === espnHome;

  const reverse =
    oddsAway === espnHome &&
    oddsHome === espnAway;

  if (validTime && (normal || reverse)) {
    matched++;
    if (!normal && reverse) reversed++;
  } else {
    failed.push(row);
  }
}

console.log(`Games checked: ${rows.length}`);
console.log(`Matched: ${matched}`);
console.log(`Reversed matches: ${reversed}`);
console.log(`Unmatched: ${failed.length}`);

for (const row of failed) {
  console.log(
    `UNMATCHED: ${row['Odds Away']} @ ${row['Odds Home']}` +
    ` | ESPN: ${row['ESPN Away']} @ ${row['ESPN Home']}`
  );
}
