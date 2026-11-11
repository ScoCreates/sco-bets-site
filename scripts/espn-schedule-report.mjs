const START_DATE = '2026-09-01';
const END_DATE = '2026-09-07';

const SPORTS = [
  {
    label: 'MLB',
    urls: date => [
      `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${date}`
    ]
  },
  {
    label: 'WNBA',
    urls: date => [
      `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=${date}`
    ]
  },
  {
    label: 'MLS',
    urls: date => [
      `https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard?dates=${date}`
    ]
  },
  {
    label: 'NCAA Football',
    urls: date => [
      `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${date}`,
      `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${date}&groups=81`
    ]
  },
  {
    label: 'NFL',
    urls: date => [
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${date}`
    ]
  }
];

function formatEspnDate(date) {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

function formatDay(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).format(date);
}

function formatTime(iso) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(iso));
}

function makeDateRange(start, end) {
  const dates = [];
  const current = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);

  while (current <= last) {
    dates.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

async function getEvents(urls) {
  const allEvents = [];

  for (const url of urls) {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        console.log(`   ESPN request failed: ${response.status}`);
        continue;
      }

      const data = await response.json();
      allEvents.push(...(data.events || []));
    } catch (error) {
      console.log(`   ESPN request error: ${error.message}`);
    }
  }

  const unique = new Map();

  for (const event of allEvents) {
    if (event?.id) {
      unique.set(String(event.id), event);
    }
  }

  return [...unique.values()];
}

const dates = makeDateRange(START_DATE, END_DATE);

console.log('');
console.log('SCO BETS AI — ESPN SCHEDULE REPORT');
console.log(`Dates: ${START_DATE} through ${END_DATE}`);
console.log('Times: Pacific');
console.log('Odds API credits used: 0');
console.log('');

for (const date of dates) {
  const espnDate = formatEspnDate(date);

  console.log('============================================================');
  console.log(formatDay(date));
  console.log('============================================================');

  for (const sport of SPORTS) {
    const events = await getEvents(sport.urls(espnDate));

    const games = events
      .filter(event => event?.date)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (!games.length) {
      console.log(`${sport.label.padEnd(16)} 0 games`);
      continue;
    }

    const first = formatTime(games[0].date);
    const last = formatTime(games[games.length - 1].date);

    console.log(
  `${sport.label.padEnd(16)} ${String(games.length).padStart(3)} games   ` +
  `First: ${first.padEnd(13)} Last: ${last}`
);

const hourlyStarts = {};

for (const game of games) {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    hour12: true
  }).format(new Date(game.date));

  hourlyStarts[hour] = (hourlyStarts[hour] || 0) + 1;
}

const hourlyText = Object.entries(hourlyStarts)
  .map(([hour, count]) => `${hour}: ${count}`)
  .join(' | ');

console.log(`   Starts by hour: ${hourlyText}`);
  }

  console.log('');
}