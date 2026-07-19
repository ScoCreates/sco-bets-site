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
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  const aliases = {
    americanleague: 'americanallstars',
    nationalleague: 'nationalallstars'
  };

  return aliases[normalized] || normalized;
}

function makeGameKey(awayTeam, homeTeam, commenceTime) {
  const dateKey = String(commenceTime || '').slice(0, 10);

  return `${normalizeTeamName(awayTeam)}_${normalizeTeamName(homeTeam)}_${dateKey}`;
}

function getPersistentGameKey(game) {
  if (game?.id) {
    return `espn_${game.id}`;
  }

  return game?.gameKey || null;
}

function mapSportToEspn(sport) {
  const map = {
    basketball_nba: { group: 'basketball', league: 'nba', dateParam: null },
    basketball_wnba: { group: 'basketball', league: 'wnba', dateParam: null },
    baseball_mlb: { group: 'baseball', league: 'mlb', dateParam: null },
    soccer_usa_mls: { group: 'soccer', league: 'usa.1', dateParam: null },
    americanfootball_nfl: { group: 'football', league: 'nfl', dateParam: null }
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

  try {
    // console.log('ESPN URL:', url);

    const response = await fetch(url);

    if (!response.ok) {
      return [];
    }

    const data = await response.json();

    return (data.events || []).map(event => {
      const competition = event.competitions?.[0];
      const competitors = competition?.competitors || [];

      const home = competitors.find(c => c.homeAway === 'home');
      const away = competitors.find(c => c.homeAway === 'away');

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
          ? home.linescores.map(ls => ({
              period: ls.period ?? null,
              value: ls.value ?? null,
              displayValue: ls.displayValue ?? String(ls.value ?? '')
            }))
          : [],

        awayLinescores: Array.isArray(away?.linescores)
          ? away.linescores.map(ls => ({
              period: ls.period ?? null,
              value: ls.value ?? null,
              displayValue: ls.displayValue ?? String(ls.value ?? '')
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
    return [];
  }
}

export default async function handler(req, res) {
  try {
    const apiKey = process.env.ODDS_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "Missing API Key" });
    }

    const requestedSport = req.query.sport || 'basketball_nba';

    const allowedSports = [
      'baseball_mlb',
      'basketball_wnba',
      'soccer_usa_mls',
      'americanfootball_nfl',

      'basketball_ncaab',
      'basketball_wncaab',
      'basketball_nba'
    ];

    const sport = allowedSports.includes(requestedSport)
      ? requestedSport
      : 'basketball_nba';

    const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds?regions=us&markets=h2h&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm,fanatics,williamhill_us&apiKey=${apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: "Odds API request failed",
        details: text
      });
    }

    const data = await response.json();

// This logs the raw Odds API response for debugging
// console.log('RAW ODDS API SAMPLE:', JSON.stringify(data?.[0], null, 2));

// DEBUG: Uncomment to see all sportsbooks returned by The Odds API

/*
console.log(
  'BOOKMAKERS:',
  [...new Set(
    data.flatMap(game =>
      (game.bookmakers || []).map(book => book.title)
    )
  )]
);
*/
    let gamesData = Array.isArray(data) ? data : [];

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const windowEnd = new Date(todayStart);

    if (sport === 'soccer_usa_mls') {
      windowEnd.setDate(windowEnd.getDate() + 30);
    } else {
      windowEnd.setDate(windowEnd.getDate() + 2);
    }

    gamesData = gamesData.filter(game => {
      const gameTime = new Date(game.commence_time);
      return gameTime >= todayStart && gameTime < windowEnd;
    });

    const totalGames = gamesData.length;

    const espnDates = new Set();

    gamesData.forEach(game => {
      if (!game.commence_time) return;

      const gameDate = new Date(game.commence_time);

      [-1, 0, 1].forEach(offset => {
        const date = new Date(gameDate);
        date.setUTCDate(date.getUTCDate() + offset);

        espnDates.add(date.toISOString().slice(0, 10).replace(/-/g, ''));
      });
    });

    if (espnDates.size === 0) {
      espnDates.add(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
    }

    const espnScoresNested = await Promise.all(
      [...espnDates].map(date => fetchEspnScores(sport, date))
    );

    const espnScoresData = espnScoresNested.flat();

    // await recordLiveGameObservations(espnScoresData, sport);


    // console.log('ESPN DATES FETCHED:', [...espnDates]);

    const espnScoreMap = {};

    espnScoresData.forEach(game => {
      if (!game.gameKey) return;

      const existingGame = espnScoreMap[game.gameKey];

      if (
        !existingGame ||
        (existingGame.statusState === 'pre' && game.statusState !== 'pre')
      ) {
        espnScoreMap[game.gameKey] = game;
      }
    });

    const simplified = gamesData.slice(0, 20).map(game => {
      const key = makeGameKey(game.away_team, game.home_team, game.commence_time);
     
      const teamOnlyKey = `${normalizeTeamName(game.away_team)}_${normalizeTeamName(game.home_team)}`;

      const oddsGameTime = new Date(game.commence_time).getTime();

      const possibleEspnMatches = espnScoresData.filter(espnGame =>
        espnGame.gameKey &&
        espnGame.gameKey.startsWith(teamOnlyKey)
      );

      const closestEspnMatch = possibleEspnMatches
        .map(espnGame => ({
          ...espnGame,
          timeDiff: Math.abs(new Date(espnGame.date).getTime() - oddsGameTime)
        }))
        .filter(espnGame => espnGame.timeDiff <= 3 * 60 * 60 * 1000)
        .sort((a, b) => {
          return a.timeDiff - b.timeDiff;
        })[0];

       const espnStatus =
         closestEspnMatch ||
         null;     

      if (!espnStatus) {
        console.log('NO ESPN MATCH:', {
          oddsKey: key,
          away: game.away_team,
          home: game.home_team,
          commence_time: game.commence_time,
          possibleEspnMatches: possibleEspnMatches.map(match => ({
            gameKey: match.gameKey,
            date: match.date,
            statusState: match.statusState,
            statusDetail: match.statusDetail,
            homeScore: match.homeScore,
            awayScore: match.awayScore,
            homeLinescores: match.homeLinescores,
            awayLinescores: match.awayLinescores
          })),
          espnKeys: Object.keys(espnScoreMap).slice(0, 20)
        });
      }

      let status = 'upcoming';
      let scores = null;

      if (espnStatus) {
        const espnState = String(espnStatus.statusState || '').toLowerCase();
        const espnName = String(espnStatus.statusName || '').toLowerCase();
        const espnDescription = String(espnStatus.statusDescription || '').toLowerCase();

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

      return {
        home: game.home_team,
        away: game.away_team,
        commence_time: game.commence_time,
        status,
        scores,
        espnStatus,
        bookmakers: (game.bookmakers || []).map(bookmaker => {
          const market = bookmaker.markets?.find(m => m.key === "h2h");

          const odds = (market?.outcomes || []).map(outcome => {
            const impliedProbability = americanToImpliedProbability(outcome.price);

            return {
              ...outcome,
              impliedProbability,
              impliedProbabilityPercent: impliedProbability !== null
                ? Number((impliedProbability * 100).toFixed(1))
                : null
            };
          });

         const totalImpliedProbability = odds.reduce((sum, outcome) => {
           return sum + (outcome.impliedProbability || 0);
          }, 0);

          const deviggedOdds = odds.map(outcome => {
            if (!outcome.impliedProbability || totalImpliedProbability === 0) {
              return {
                ...outcome,
                fairProbability: null,
                fairProbabilityPercent: null
              };
            }

          const fairProbability = outcome.impliedProbability / totalImpliedProbability;
          const fairOdds = probabilityToAmericanOdds(fairProbability);

          const edge = fairProbability - outcome.impliedProbability;

          return {
            ...outcome,
            fairProbability,
            fairProbabilityPercent: Number((fairProbability * 100).toFixed(1)),
            fairOdds,
            edge,
            edgePercent: Number((edge * 100).toFixed(1))
          };
        });

          const marketHold = totalImpliedProbability - 1;

          let holdLevel = "Low Hold";
          if (marketHold >= 0.07) {
            holdLevel = "High Hold";
          } else if (marketHold >= 0.04) {
            holdLevel = "Medium Hold";
         }

          return {
            title: bookmaker.title,
            lastUpdate: bookmaker.last_update || market?.last_update || null,
            odds: deviggedOdds,
            marketHold,
            marketHoldPercent: Number((marketHold * 100).toFixed(1)),
            holdLevel
          };
        }).filter(b => b.odds.length >= 2)
      };
    });

    const completedGames = espnScoresData.filter(game => {
      const name = String(game.statusName || '').toUpperCase();
      const description = String(game.statusDescription || '').toLowerCase();
      const detail = String(game.statusDetail || '').toLowerCase();

    const isPostponed =
      name.includes('POSTPONED') ||
      description.includes('postponed') ||
      detail.includes('postponed');

  const isCanceled =
    name.includes('CANCELED') ||
    name.includes('CANCELLED') ||
    description.includes('canceled') ||
    description.includes('cancelled') ||
    detail.includes('canceled') ||
    detail.includes('cancelled');

  const isFinal =
    name.includes('FINAL') ||
    description.includes('final') ||
    detail.includes('final');

  return isFinal && !isPostponed && !isCanceled;
});

    // await upsertCompletedGames(completedGames, sport);
    
    res.status(200).json({
      sport,
      games: simplified,
      completedGames,
      totalGames
    });

  } catch (err) {
    res.status(500).json({
      error: "Failed to load odds",
      details: err.message
    });
  }
}