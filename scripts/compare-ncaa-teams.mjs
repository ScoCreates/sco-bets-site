
const API_KEY = process.env.ODDS_API_KEY;

if (!API_KEY) {
  console.error('ODDS_API_KEY is missing.');
  process.exit(1);
}

const fs = await import('node:fs/promises');

const oddsUrl = new URL(
  'https://api.the-odds-api.com/v4/sports/basketball_ncaab/events'
);
oddsUrl.searchParams.set('apiKey', API_KEY);

const espnBase =
  'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard';

const normalize = value =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

function similarity(a, b) {
  a = normalize(a);
  b = normalize(b);

  if (a === b) return 1;
  if (!a || !b) return 0;

  const dp = Array.from(
    { length: b.length + 1 },
    (_, i) => i
  );

  for (let i = 1; i <= a.length; i++) {
    let previous = dp[0];
    dp[0] = i;

    for (let j = 1; j <= b.length; j++) {
      const old = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      previous = old;
    }
  }

  return 1 - dp[b.length] / Math.max(a.length, b.length);
}

function csv(rows) {
  return rows.map(row =>
    row.map(value =>
      '"' + String(value ?? '').replace(/"/g, '""') + '"'
    ).join(',')
  ).join('\n') + '\n';
}

async function getJson(url, label) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${label}: HTTP ${response.status}`);
  }

  return response.json();
}

const oddsGames = await getJson(oddsUrl, 'The Odds API');

console.log(`Odds API events: ${oddsGames.length}`);

const dates = new Set();

for (const game of oddsGames) {
  const date = new Date(game.commence_time);

  if (Number.isNaN(date.getTime())) continue;

  for (const offset of [-1, 0, 1]) {
    const day = new Date(date);
    day.setUTCDate(day.getUTCDate() + offset);
    dates.add(day.toISOString().slice(0, 10).replace(/-/g, ''));
  }
}

const espnGamesMap = new Map();

for (const date of [...dates].sort()) {
  const url = new URL(espnBase);
  url.searchParams.set('dates', date);
  url.searchParams.set('groups', '50');
  url.searchParams.set('limit', '300');

  const data = await getJson(url, `ESPN ${date}`);

  for (const event of data.events || []) {
    const competitors = event.competitions?.[0]?.competitors || [];

    const away = competitors.find(c => c.homeAway === 'away');
    const home = competitors.find(c => c.homeAway === 'home');

    if (!away?.team?.displayName || !home?.team?.displayName) {
      continue;
    }

    espnGamesMap.set(String(event.id), {
      id: event.id,
      away: away.team.displayName,
      home: home.team.displayName,
      date: event.date
    });
  }
}

const espnGames = [...espnGamesMap.values()];

console.log(`ESPN events: ${espnGames.length}`);

const comparison = [[
  'Status',
  'Odds Away',
  'Odds Home',
  'ESPN Away',
  'ESPN Home',
  'Odds Start UTC',
  'ESPN Start UTC',
  'Time Difference Minutes',
  'Team Similarity',
  'ESPN Event ID'
]];

const aliases = [[
  'Odds API Name',
  'ESPN Name',
  'Similarity',
  'Game',
  'Review Status'
]];

const usedEspn = new Set();
let exact = 0;
let likely = 0;
let unmatched = 0;

for (const game of oddsGames) {
  const oddsTime = new Date(game.commence_time).getTime();

  const candidates = espnGames
    .filter(event => !usedEspn.has(String(event.id)))
    .map(event => {
      const minutes = Math.abs(
        new Date(event.date).getTime() - oddsTime
      ) / 60000;

      const normalAway = similarity(game.away_team, event.away);
      const normalHome = similarity(game.home_team, event.home);

      const reversedAway = similarity(game.away_team, event.home);
      const reversedHome = similarity(game.home_team, event.away);

      const reversed =
        reversedAway + reversedHome >
        normalAway + normalHome;

      const awayScore = reversed ? reversedAway : normalAway;
      const homeScore = reversed ? reversedHome : normalHome;

      return {
        event,
        minutes,
        awayScore,
        homeScore,
        reversed,
        score: (awayScore + homeScore) / 2
      };
    })
    .filter(item =>
      Number.isFinite(item.minutes) &&
      item.minutes <= 180
    )
    .sort((a, b) =>
      b.score - a.score || a.minutes - b.minutes
    );

  const best = candidates[0];

  // Require both team names to be reasonably similar.
  // Suggestions are for manual review, never automatic aliases.
  const accepted = best &&
    best.awayScore >= 0.55 &&
    best.homeScore >= 0.55;

  if (!accepted) {
    unmatched++;

    comparison.push([
      'UNMATCHED',
      game.away_team,
      game.home_team,
      best?.event.away || '',
      best?.event.home || '',
      game.commence_time,
      best?.event.date || '',
      best ? best.minutes.toFixed(1) : '',
      best ? best.score.toFixed(3) : '',
      best?.event.id || ''
    ]);

    continue;
  }

  usedEspn.add(String(best.event.id));

  const matchedAway = best.reversed
    ? best.event.home
    : best.event.away;

  const matchedHome = best.reversed
    ? best.event.away
    : best.event.home;

  const namesMatch =
    normalize(game.away_team) === normalize(matchedAway) &&
    normalize(game.home_team) === normalize(matchedHome);

  if (namesMatch) exact++;
  else likely++;

  comparison.push([
    best.reversed
      ? (namesMatch ? 'REVERSED TEAMS' : 'REVERSED + REVIEW NAMES')
      : (namesMatch ? 'EXACT' : 'REVIEW NAMES'),
    game.away_team,
    game.home_team,
    best.event.away,
    best.event.home,
    game.commence_time,
    best.event.date,
    best.minutes.toFixed(1),
    best.score.toFixed(3),
    best.event.id
  ]);

  for (const [oddsName, espnName] of [
    [game.away_team, matchedAway],
    [game.home_team, matchedHome]
  ]) {
    if (normalize(oddsName) !== normalize(espnName)) {
      aliases.push([
        oddsName,
        espnName,
        similarity(oddsName, espnName).toFixed(3),
        `${game.away_team} at ${game.home_team}`,
        'NEEDS REVIEW'
      ]);
    }
  }
}

const espnUnmatched = [[
  'ESPN Away',
  'ESPN Home',
  'Start UTC',
  'ESPN Event ID'
]];

for (const event of espnGames) {
  if (!usedEspn.has(String(event.id))) {
    espnUnmatched.push([
      event.away,
      event.home,
      event.date,
      event.id
    ]);
  }
}

await fs.writeFile(
  'ncaa-team-comparison.csv',
  csv(comparison)
);

await fs.writeFile(
  'ncaa-team-alias-candidates.csv',
  csv(aliases)
);

await fs.writeFile(
  'ncaa-espn-unmatched.csv',
  csv(espnUnmatched)
);

console.log({
  exact,
  reviewNames: likely,
  unmatched,
  aliasCandidates: aliases.length - 1,
  espnWithoutOddsMatch: espnUnmatched.length - 1
});

console.log('Three CSV reports saved.');
