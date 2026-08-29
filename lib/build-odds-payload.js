function americanToImpliedProbability(odds) {
  const numOdds = Number(odds);

  if (!Number.isFinite(numOdds) || numOdds === 0) {
    return null;
  }

  if (numOdds > 0) {
    return 100 / (numOdds + 100);
  }

  return Math.abs(numOdds) / (Math.abs(numOdds) + 100);
}

function probabilityToAmericanOdds(probability) {
  const prob = Number(probability);

  if (!Number.isFinite(prob) || prob <= 0 || prob >= 1) {
    return null;
  }

  if (prob >= 0.5) {
    return Math.round(-(prob / (1 - prob)) * 100);
  }

  return Math.round(((1 - prob) / prob) * 100);
}

function normalizeTeamName(name) {
  const normalized = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  const aliases = {
    americanleague: 'americanallstars',
    nationalleague: 'nationalallstars',

    // MLS provider-name differences
    chicagofire: 'chicagofirefc',
    columbuscrewsc: 'columbuscrew',
    newyorkredbulls: 'redbullnewyork',
    vancouverwhitecapsfc: 'vancouverwhitecaps',
    cfmontreal: 'cfmontral',
    losangelesfc: 'lafc',

    // NCAA provider-name differences
    southernuniversityjaguars: 'southernjaguars'
  };

  return aliases[normalized] || normalized;
}

function makeGameKey(awayTeam, homeTeam, commenceTime) {
  const dateKey = String(commenceTime || '').slice(0, 10);

  return `${normalizeTeamName(awayTeam)}_${normalizeTeamName(homeTeam)}_${dateKey}`;
}

function mapSportToEspn(sport) {
  const map = {
    basketball_nba: { group: 'basketball', league: 'nba', dateParam: null },
    basketball_wnba: { group: 'basketball', league: 'wnba', dateParam: null },
    baseball_mlb: { group: 'baseball', league: 'mlb', dateParam: null },
    soccer_usa_mls: { group: 'soccer', league: 'usa.1', dateParam: null },
    americanfootball_nfl: { group: 'football', league: 'nfl', dateParam: null },
    americanfootball_ncaaf: {
      group: 'football',
      league: 'college-football',
      dateParam: null
    }
  };

  return map[sport] || null;
}

async function fetchEspnScores(sport, espnDate) {
  const espnSport = mapSportToEspn(sport);

  if (!espnSport) {
    return [];
  }

  const today =
    espnDate ||
    new Date().toISOString().slice(0, 10).replace(/-/g, '');

   const url =
    `https://site.api.espn.com/apis/site/v2/sports/${espnSport.group}/${espnSport.league}/scoreboard?dates=${today}`;

  const urls =
    sport === 'americanfootball_ncaaf'
      ? [url, `${url}&groups=81`]
      : [url];

  try {
        const responses = await Promise.all(
      urls.map(fetchUrl => fetch(fetchUrl))
    );

    for (const response of responses) {
      if (!response.ok) {
        const details = await response.text();

        console.error('ESPN SNAPSHOT FETCH FAILED:', {
          sport,
          espnDate: today,
          status: response.status,
          details
        });

        return [];
      }
    }

    const dataSets = await Promise.all(
      responses.map(item => item.json())
    );

    const eventMap = new Map();

    for (const dataSet of dataSets) {
      for (const event of dataSet.events || []) {
        if (event?.id) {
          eventMap.set(event.id, event);
        }
      }
    }

    const data = {
      events: Array.from(eventMap.values())
    };
	
	
    return (data.events || []).map(event => {
      const competition = event.competitions?.[0];
      const competitors = competition?.competitors || [];

      const home = competitors.find(
        competitor => competitor.homeAway === 'home'
      );

      const away = competitors.find(
        competitor => competitor.homeAway === 'away'
      );

      const status = competition?.status || event.status || {};
      const type = status.type || {};

      return {
        id: event.id,
        name: event.name,
        shortName: event.shortName,
        date: event.date,

        statusName: type.name || null,
        statusState: type.state || null,
        statusDescription: type.description || null,
        statusDetail: type.detail || null,

        period: status.period ?? null,
        clock: status.displayClock || null,

        homeTeam: home?.team?.displayName || null,
        awayTeam: away?.team?.displayName || null,
        homeShort: home?.team?.abbreviation || null,
        awayShort: away?.team?.abbreviation || null,

        homeRecord:
          home?.records?.find(record => record.type === 'total')?.summary ||
          home?.records?.[0]?.summary ||
          null,

        awayRecord:
          away?.records?.find(record => record.type === 'total')?.summary ||
          away?.records?.[0]?.summary ||
          null,

        homeScore: home?.score || '0',
        awayScore: away?.score || '0',

        homeLinescores: Array.isArray(home?.linescores)
          ? home.linescores.map(linescore => ({
              period: linescore.period ?? null,
              value: linescore.value ?? null,
              displayValue:
                linescore.displayValue ??
                String(linescore.value ?? '')
            }))
          : [],

        awayLinescores: Array.isArray(away?.linescores)
          ? away.linescores.map(linescore => ({
              period: linescore.period ?? null,
              value: linescore.value ?? null,
              displayValue:
                linescore.displayValue ??
                String(linescore.value ?? '')
            }))
          : [],

        gameKey: makeGameKey(
          away?.team?.displayName,
          home?.team?.displayName,
          event.date
        )
      };
    });
  } catch (err) {
    console.error('ESPN SNAPSHOT FETCH ERROR:', {
      sport,
      espnDate: today,
      error: err.message
    });

    return [];
  }
}

function normalizeBookmaker(bookmaker) {
  const market = bookmaker.markets?.find(
    marketItem => marketItem.key === 'h2h'
  );

  const odds = (market?.outcomes || []).map(outcome => {
    const impliedProbability =
      americanToImpliedProbability(outcome.price);

    return {
      ...outcome,
      impliedProbability,
      impliedProbabilityPercent:
        impliedProbability !== null
          ? Number((impliedProbability * 100).toFixed(1))
          : null
    };
  });

  const totalImpliedProbability = odds.reduce(
    (sum, outcome) =>
      sum + (outcome.impliedProbability || 0),
    0
  );

  const deviggedOdds = odds.map(outcome => {
    if (
      !outcome.impliedProbability ||
      totalImpliedProbability === 0
    ) {
      return {
        ...outcome,
        fairProbability: null,
        fairProbabilityPercent: null
      };
    }

    const fairProbability =
      outcome.impliedProbability /
      totalImpliedProbability;

    const fairOdds =
      probabilityToAmericanOdds(fairProbability);

    const edge =
      fairProbability -
      outcome.impliedProbability;

    return {
      ...outcome,
      fairProbability,
      fairProbabilityPercent:
        Number((fairProbability * 100).toFixed(1)),
      fairOdds,
      edge,
      edgePercent:
        Number((edge * 100).toFixed(1))
    };
  });

  const marketHold =
    totalImpliedProbability - 1;

  let holdLevel = 'Low Hold';

  if (marketHold >= 0.07) {
    holdLevel = 'High Hold';
  } else if (marketHold >= 0.04) {
    holdLevel = 'Medium Hold';
  }

  return {
    title: bookmaker.title,
    lastUpdate:
      bookmaker.last_update ||
      market?.last_update ||
      null,
    odds: deviggedOdds,
    marketHold,
    marketHoldPercent:
      Number((marketHold * 100).toFixed(1)),
    holdLevel
  };
}

function findClosestEspnMatch(game, espnScoresData) {
  const teamOnlyKey =
    `${normalizeTeamName(game.away_team)}_` +
    `${normalizeTeamName(game.home_team)}`;

  const oddsGameTime = new Date(game.commence_time).getTime();

  if (!Number.isFinite(oddsGameTime)) {
    return null;
  }

  const possibleMatches = espnScoresData.filter(espnGame =>
    espnGame.gameKey &&
    espnGame.gameKey.startsWith(teamOnlyKey)
  );

  const closestMatch = possibleMatches
    .map(espnGame => ({
      ...espnGame,
      timeDiff: Math.abs(
        new Date(espnGame.date).getTime() - oddsGameTime
      )
    }))
    .filter(espnGame =>
      Number.isFinite(espnGame.timeDiff) &&
      espnGame.timeDiff <= 3 * 60 * 60 * 1000
    )
    .sort((a, b) => a.timeDiff - b.timeDiff)[0];

  return closestMatch || null;
}

function findEspnMatchForPreviousGame(
  previousGame,
  espnScoresData
) {
  if (!previousGame) {
    return null;
  }

  const oddsStyleGame = {
    away_team: previousGame.away,
    home_team: previousGame.home,
    commence_time: previousGame.commence_time
  };

  return findClosestEspnMatch(
    oddsStyleGame,
    espnScoresData
  );
}

function refreshPreviousGame(
  previousGame,
  espnScoresData
) {
  const espnStatus =
    findEspnMatchForPreviousGame(
      previousGame,
      espnScoresData
    );

  if (!espnStatus) {
    return null;
  }

  const espnState =
    String(espnStatus.statusState || '').toLowerCase();

  const espnName =
    String(espnStatus.statusName || '').toLowerCase();

  const espnDescription =
    String(
      espnStatus.statusDescription || ''
    ).toLowerCase();

  const espnDetail =
    String(
      espnStatus.statusDetail || ''
    ).toLowerCase();

  const isFinal =
    espnState === 'post' ||
    espnName.includes('final') ||
    espnDescription.includes('final') ||
    espnDetail.includes('final');
	
  if (isFinal) {
    return null;
  }

  const isLive =
    espnState === 'in';

  const isDelayed =
    espnName.includes('delayed') ||
    espnName.includes('rain_delay') ||
    espnDescription.includes('delayed') ||
    espnDescription.includes('rain delay') ||
    espnDetail.includes('delayed') ||
    espnDetail.includes('rain delay');

  const isSuspended =
    espnName.includes('suspended') ||
    espnDescription.includes('suspended') ||
    espnDetail.includes('suspended');

  if (
    !isLive &&
    !isFinal &&
    !isDelayed &&
    !isSuspended
  ) {
    return null;
  }

  let status = previousGame.status || 'upcoming';

  if (isFinal) {
    status = 'final';
  } else if (
    isLive ||
    isDelayed ||
    isSuspended
  ) {
    status = 'live';
  }

  return {
    ...previousGame,
    status,
    scores: previousGame.scores || null,
    espnStatus,
    retainedMarket: true
  };
}

function normalizeGame(game, espnScoresData) {
  const espnStatus =
    findClosestEspnMatch(game, espnScoresData);

  let status = 'upcoming';
  let scores = null;

  if (espnStatus) {
    const espnState =
      String(espnStatus.statusState || '').toLowerCase();

    const espnName =
      String(espnStatus.statusName || '').toLowerCase();

    const espnDescription =
      String(espnStatus.statusDescription || '').toLowerCase();

    if (
      espnState === 'post' ||
      espnName.includes('final') ||
      espnDescription.includes('final')
    ) {
      status = 'final';
    } else if (
      espnState === 'in' ||
      espnDescription.includes('rain delay') ||
      espnDescription.includes('delayed')
    ) {
      status = 'live';
    }
  }

  const bookmakers = (game.bookmakers || [])
    .map(normalizeBookmaker)
    .filter(bookmaker => bookmaker.odds.length >= 2);

  return {
    home: game.home_team,
    away: game.away_team,
    commence_time: game.commence_time,
    status,
    scores,
    espnStatus,
    bookmakers
  };
}

export async function buildOddsPayload(
  requestedSport,
  previousGames = []
) {
  const apiKey = process.env.ODDS_API_KEY;

  if (!apiKey) {
    throw new Error('Missing Odds API key.');
  }

const allowedSports = [
  'baseball_mlb',
  'basketball_wnba',
  'soccer_usa_mls',
  'americanfootball_nfl',
  'americanfootball_ncaaf',
  'basketball_ncaab',
  'basketball_wncaab',
  'basketball_nba'
];

  const sport = allowedSports.includes(requestedSport)
    ? requestedSport
    : 'basketball_nba';

const oddsApiSports =
  sport === 'americanfootball_ncaaf'
    ? ['americanfootball_ncaaf', 'americanfootball_ncaaf_fcs']
    : sport === 'americanfootball_nfl'
    ? ['americanfootball_nfl_preseason']
    : [sport];

let oddsData = [];

for (const oddsApiSport of oddsApiSports) {
  const oddsUrl =
    `https://api.the-odds-api.com/v4/sports/${oddsApiSport}/odds` +
    `?regions=us` +
    `&markets=h2h` +
    `&oddsFormat=american` +
    `&bookmakers=draftkings,fanduel,betmgm,fanatics,williamhill_us` +
    `&apiKey=${apiKey}`;

  const oddsResponse = await fetch(oddsUrl);

  if (!oddsResponse.ok) {
    const details = await oddsResponse.text();

    throw new Error(
      `Odds API request failed (${oddsResponse.status}): ${details}`
    );
  }

  const sportData = await oddsResponse.json();

  if (Array.isArray(sportData)) {
    oddsData.push(...sportData);
  }
}

let gamesData = oddsData;

  const now = new Date();
  const todayStart = new Date(now);

  todayStart.setHours(0, 0, 0, 0);

  const windowEnd = new Date(todayStart);

  if (sport === 'soccer_usa_mls') {
    windowEnd.setDate(windowEnd.getDate() + 30);
  } else if (
    sport === 'americanfootball_nfl' ||
    sport === 'americanfootball_ncaaf'
  ) {
    windowEnd.setDate(windowEnd.getDate() + 14);
  } else {
  windowEnd.setDate(windowEnd.getDate() + 2);

  /*
   * Add a small timezone buffer so late-evening U.S. games
   * on the second local calendar day are not cut off at
   * midnight UTC.
   */
  windowEnd.setHours(windowEnd.getHours() + 12);
}

  gamesData = gamesData.filter(game => {
    const gameTime = new Date(game.commence_time);

    return gameTime >= todayStart && gameTime < windowEnd;
  });

  const totalGames = gamesData.length;
  const espnDates = new Set();

  gamesData.forEach(game => {
    if (!game.commence_time) {
      return;
    }

    const gameDate = new Date(game.commence_time);

    [-1, 0, 1].forEach(offset => {
      const date = new Date(gameDate);

      date.setUTCDate(date.getUTCDate() + offset);

      espnDates.add(
        date.toISOString().slice(0, 10).replace(/-/g, '')
      );
    });
  });

  if (espnDates.size === 0) {
    espnDates.add(
      new Date().toISOString().slice(0, 10).replace(/-/g, '')
    );
  }

  const espnScoresNested = await Promise.all(
    [...espnDates].map(date =>
      fetchEspnScores(sport, date)
    )
  );

  const espnScoresData = espnScoresNested.flat();

  console.log('SNAPSHOT ESPN DEBUG:', {
    sport,
    espnDates: [...espnDates],
    espnGameCount: espnScoresData.length,
    sampleGames: espnScoresData.slice(0, 3).map(game => ({
      away: game.awayTeam,
      home: game.homeTeam,
      status: game.statusName,
      gameKey: game.gameKey
    }))
  });

  const espnScoreMap = {};

  espnScoresData.forEach(game => {
    if (!game.gameKey) {
      return;
    }

    const existingGame = espnScoreMap[game.gameKey];

    if (
      !existingGame ||
      (
        existingGame.statusState === 'pre' &&
        game.statusState !== 'pre'
      )
    ) {
      espnScoreMap[game.gameKey] = game;
    }
  });

    const freshGames = gamesData.map(game =>
  normalizeGame(game, espnScoresData)
);

const freshGameKeys = new Set(
  freshGames.map(game =>
    makeGameKey(
      game.away,
      game.home,
      game.commence_time
    )
  )
);

const retainedGames = (
  Array.isArray(previousGames)
    ? previousGames
    : []
)
  .filter(previousGame => {
    const previousGameKey = makeGameKey(
      previousGame.away,
      previousGame.home,
      previousGame.commence_time
    );

    return !freshGameKeys.has(previousGameKey);
  })
  .map(previousGame =>
    refreshPreviousGame(
      previousGame,
      espnScoresData
    )
  )
  .filter(Boolean);

const games = [
  ...freshGames,
  ...retainedGames
];

  const completedGames = espnScoresData.filter(game => {
    const statusName =
      String(game.statusName || '').toUpperCase();

    const statusDescription =
      String(game.statusDescription || '').toLowerCase();

    const statusDetail =
      String(game.statusDetail || '').toLowerCase();

    const isPostponed =
      statusName.includes('POSTPONED') ||
      statusDescription.includes('postponed') ||
      statusDetail.includes('postponed');

    const isCanceled =
      statusName.includes('CANCELED') ||
      statusName.includes('CANCELLED') ||
      statusDescription.includes('canceled') ||
      statusDescription.includes('cancelled') ||
      statusDetail.includes('canceled') ||
      statusDetail.includes('cancelled');

    const isFinal =
      statusName.includes('FINAL') ||
      statusDescription.includes('final') ||
      statusDetail.includes('final');

    return isFinal && !isPostponed && !isCanceled;
  });

  return {
  sport,
  games,
  completedGames,
  totalGames,

  debug: {
    rawOddsGameCount:
      Array.isArray(oddsData)
        ? oddsData.length
        : null,

    rawOddsGames:
      Array.isArray(oddsData)
        ? oddsData.map(game => ({
            away: game.away_team,
            home: game.home_team,
            commence_time: game.commence_time
          }))
        : []
  }
};
}