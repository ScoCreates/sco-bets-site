const supabase = require('../lib/supabase');

const sportMap = {
  baseball_mlb: {
    group: 'baseball',
    league: 'mlb'
  },
  basketball_wnba: {
    group: 'basketball',
    league: 'wnba'
  },
  basketball_nba: {
    group: 'basketball',
    league: 'nba'
  },
  soccer_usa_mls: {
    group: 'soccer',
    league: 'usa.1'
  },
  americanfootball_nfl: {
    group: 'football',
    league: 'nfl'
  }
};

const defaultSports = [
  'baseball_mlb',
  'basketball_wnba',
  'basketball_nba',
  'soccer_usa_mls',
  'americanfootball_nfl'
];

function getRequestedSports(req) {
  const requestedSport = String(
    req.query.sport || ''
  ).trim();

  if (!requestedSport) {
    return defaultSports;
  }

  if (!sportMap[requestedSport]) {
    return null;
  }

  return [requestedSport];
}

function isCompletedGame(game) {
  const state = String(
    game.statusState || ''
  ).toLowerCase();

  const name = String(
    game.statusName || ''
  ).toUpperCase();

  const description = String(
    game.statusDescription || ''
  ).toLowerCase();

  const isPostponed =
    name.includes('POSTPONED') ||
    description.includes('postponed');

  const isCanceled =
    name.includes('CANCELED') ||
    name.includes('CANCELLED') ||
    description.includes('canceled') ||
    description.includes('cancelled');

  const isFinal =
  game.completed === true &&
  (
    state === 'post' ||
    name.includes('FINAL') ||
    name.includes('FULL_TIME') ||
    description.includes('final') ||
    description.includes('full time')
  );

  return isFinal && !isPostponed && !isCanceled;
}

async function upsertCompletedGames(completedGames, sport) {
  if (
    !Array.isArray(completedGames) ||
    completedGames.length === 0
  ) {
    return;
  }
  
  const completedGameKeys = completedGames
  .map(game => game.gameKey)
  .filter(Boolean);

if (completedGameKeys.length === 0) {
  return;
}

const {
  data: existingCompletedGames,
  error: existingCompletedGamesError
} = await supabase
  .from('completed_games')
  .select('game_key, away_score, home_score')
  .in('game_key', completedGameKeys);

if (existingCompletedGamesError) {
  throw new Error(
    `Failed to check existing completed ${sport} games: ` +
    existingCompletedGamesError.message
  );
}

const existingCompletedGameMap = new Map(
  (existingCompletedGames || []).map(game => [
    game.game_key,
    game
  ])
);

  const rows = completedGames
  .filter(game => {
    if (!game.gameKey) {
      return false;
    }

    const existingGame =
      existingCompletedGameMap.get(game.gameKey);

    // This completed game has never been stored.
    if (!existingGame) {
      return true;
    }

    const awayScore = Number.isFinite(
      Number(game.awayScore)
    )
      ? Number(game.awayScore)
      : null;

    const homeScore = Number.isFinite(
      Number(game.homeScore)
    )
      ? Number(game.homeScore)
      : null;

    const existingAwayScore = Number.isFinite(
      Number(existingGame.away_score)
    )
      ? Number(existingGame.away_score)
      : null;

    const existingHomeScore = Number.isFinite(
      Number(existingGame.home_score)
    )
      ? Number(existingGame.home_score)
      : null;

    /*
     * Skip the database write when this completed game
     * is already stored with the same final score.
     *
     * If ESPN later corrects the score, allow the
     * existing UPSERT below to update the row.
     */
    return (
      awayScore !== existingAwayScore ||
      homeScore !== existingHomeScore
    );
  })
  .map(game => ({
      game_key: game.gameKey,
      sport,
      espn_game_id: game.id || null,
      away_team: game.awayTeam,
      home_team: game.homeTeam,

      away_score: Number.isFinite(
        Number(game.awayScore)
      )
        ? Number(game.awayScore)
        : null,

      home_score: Number.isFinite(
        Number(game.homeScore)
      )
        ? Number(game.homeScore)
        : null,

      espn_status: game,
      updated_at: new Date().toISOString()
    }));
	
console.log('COMPLETED GAMES WRITE CHECK:', {
  sport,
  completedGamesFound: completedGames.length,
  rowsToWrite: rows.length
});	

  if (rows.length === 0) {
    return;
  }

  const { error } = await supabase
    .from('completed_games')
    .upsert(rows, {
      onConflict: 'game_key',
      ignoreDuplicates: false
    });

  if (error) {
    throw new Error(
      `Failed to store completed ${sport} games: ` +
      error.message
    );
  }
}

async function fetchEspnGames(requestedSport, date) {
  const espnSport = sportMap[requestedSport];

  const url =
    `https://site.api.espn.com/apis/site/v2/sports/` +
    `${espnSport.group}/${espnSport.league}/scoreboard?dates=${date}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `ESPN request failed for ${requestedSport}: ${response.status}`
    );
  }

  const data = await response.json();

  return (data.events || []).map(event => {
    const competition = event.competitions?.[0];
    const competitors = competition?.competitors || [];

    const home = competitors.find(
      competitor => competitor.homeAway === 'home'
    );

    const away = competitors.find(
      competitor => competitor.homeAway === 'away'
    );

    return {
      id: event.id,
      gameKey: event.id
        ? `espn_${event.id}`
        : null,

      name: event.name,
      date: event.date,

      awayTeam:
        away?.team?.displayName || null,

      homeTeam:
        home?.team?.displayName || null,

      awayScore:
        away?.score ?? null,

      homeScore:
        home?.score ?? null,

      statusName:
        event.status?.type?.name || null,

      statusState:
        event.status?.type?.state || null,

      statusDescription:
        event.status?.type?.description || null,

      completed:
        event.status?.type?.completed ?? false
    };
  });
}

async function processSport(requestedSport, dates) {
  const gamesByDate = await Promise.all(
    dates.map(date =>
      fetchEspnGames(requestedSport, date)
    )
  );

  const gamesByKey = new Map();

  gamesByDate
    .flat()
    .forEach(game => {
      if (game.gameKey) {
        gamesByKey.set(game.gameKey, game);
      }
    });

  const games = Array.from(
    gamesByKey.values()
  );

  const gameKeys = games
    .map(game => game.gameKey)
    .filter(Boolean);

  const observedAt = new Date().toISOString();

  const liveGames = games.filter(game => {
    const state = String(
      game.statusState || ''
    ).toLowerCase();

    return game.gameKey && state === 'in';
  });

  const liveObservationRows = liveGames.map(
    game => ({
      game_key: game.gameKey,
      espn_game_id: game.id,
      away_team: game.awayTeam,
      home_team: game.homeTeam,
      sport: requestedSport,
      seen_live_at: observedAt,
      completed_observed_at: null,
      last_status: 'live',
      updated_at: observedAt
    })
  );

  const completedGames = games.filter(
    isCompletedGame
  );

const possibleFinalGames = games.filter(game => {
  const state = String(
    game.statusState || ''
  ).toLowerCase();

  const name = String(
    game.statusName || ''
  ).toUpperCase();

  const description = String(
    game.statusDescription || ''
  ).toLowerCase();

  return (
    state === 'post' ||
    name.includes('FINAL') ||
    description.includes('final') ||
    game.completed === true
  );
});

if (possibleFinalGames.length > 0) {
  console.log('OBSERVER FINAL CHECK:', {
    sport: requestedSport,
    dates,
    possibleFinalGames: possibleFinalGames.map(game => ({
      gameKey: game.gameKey,
      name: game.name,
      statusName: game.statusName,
      statusState: game.statusState,
      statusDescription: game.statusDescription,
      completed: game.completed,
      acceptedAsCompleted:
        completedGames.some(
          completedGame =>
            completedGame.gameKey === game.gameKey
        )
    }))
  });
}

  if (liveObservationRows.length > 0) {
    const {
      error: liveInsertError
    } = await supabase
      .from('game_observations')
      .upsert(liveObservationRows, {
        onConflict: 'game_key',
        ignoreDuplicates: true
      });

    if (liveInsertError) {
      throw new Error(
        `Failed to record live ${requestedSport} games: ` +
        liveInsertError.message
      );
    }

    for (const game of liveGames) {
      const {
        error: metadataUpdateError
      } = await supabase
        .from('game_observations')
        .update({
          espn_game_id: game.id,
          away_team: game.awayTeam,
          home_team: game.homeTeam
        })
        .eq('game_key', game.gameKey);

      if (metadataUpdateError) {
        throw new Error(
          `Failed to update ${requestedSport} game information: ` +
          metadataUpdateError.message
        );
      }
    }
  }

  let existingObservations = [];

  if (gameKeys.length > 0) {
    const {
      data: observationData,
      error: observationError
    } = await supabase
      .from('game_observations')
      .select(
        'game_key, seen_live_at, completed_observed_at, last_status'
      )
      .in('game_key', gameKeys);

    if (observationError) {
      throw new Error(
        `Failed to read ${requestedSport} observations: ` +
        observationError.message
      );
    }

    existingObservations =
      observationData || [];
  }

  const observationMap = new Map(
    existingObservations.map(observation => [
      observation.game_key,
      observation
    ])
  );

  const gamesNeedingCompletion =
    completedGames.filter(game => {
      const observation =
        observationMap.get(game.gameKey);

      if (
        !observation?.seen_live_at ||
        observation.completed_observed_at
      ) {
        return false;
      }

      const seenLiveAt =
        new Date(observation.seen_live_at).getTime();

      const hoursSinceSeenLive =
        (Date.now() - seenLiveAt) /
        (60 * 60 * 1000);

      return (
        Number.isFinite(hoursSinceSeenLive) &&
        hoursSinceSeenLive <= 8
      );
    });

  for (const game of gamesNeedingCompletion) {
    const completedAt =
      new Date().toISOString();

    const {
      error: completionUpdateError
    } = await supabase
      .from('game_observations')
      .update({
        completed_observed_at: completedAt,
        last_status: 'final',
        updated_at: completedAt
      })
      .eq('game_key', game.gameKey)
      .is('completed_observed_at', null);

    if (completionUpdateError) {
      throw new Error(
        `Failed to record ${requestedSport} completion: ` +
        completionUpdateError.message
      );
    }
  }

await upsertCompletedGames(
  completedGames,
  requestedSport
);

  return {
    sport: requestedSport,
    gameCount: games.length,
    liveGameCount:
      liveObservationRows.length,
    completedGameCount:
      completedGames.length,
    newlyCompletedGameCount:
      gamesNeedingCompletion.length,
    observationCount:
      existingObservations.length,
    games,
    existingObservations
  };
}

module.exports = async (req, res) => {
  try {
    const cronSecret = process.env.CRON_SECRET;

    if (
      cronSecret &&
      req.headers.authorization !== `Bearer ${cronSecret}`
    ) {
      return res.status(401).json({
        ok: false,
        error: 'Unauthorized'
      });
    }
    const requestedSports =
      getRequestedSports(req);

    if (!requestedSports) {
      return res.status(400).json({
        ok: false,
        error: 'Unsupported sport'
      });
    }

    function formatPacificDate(dateValue) {
  const parts = new Intl.DateTimeFormat(
    'en-US',
    {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }
  ).formatToParts(dateValue);

  const values = Object.fromEntries(
    parts.map(part => [
      part.type,
      part.value
    ])
  );

  return (
    `${values.year}` +
    `${values.month}` +
    `${values.day}`
  );
}

const now = new Date();

const yesterday = new Date(
  now.getTime() - 24 * 60 * 60 * 1000
);

const dates = [
  formatPacificDate(now),
  formatPacificDate(yesterday)
];

    const results = [];

    for (const requestedSport of requestedSports) {
      const result = await processSport(
        requestedSport,
        dates
      );

      results.push(result);
    }

    if (requestedSports.length === 1) {
      return res.status(200).json({
        ok: true,
        ...results[0]
      });
    }

    return res.status(200).json({
      ok: true,
      sportCount: results.length,
      totals: {
        gameCount: results.reduce(
          (total, result) =>
            total + result.gameCount,
          0
        ),
        liveGameCount: results.reduce(
          (total, result) =>
            total + result.liveGameCount,
          0
        ),
        completedGameCount: results.reduce(
          (total, result) =>
            total + result.completedGameCount,
          0
        ),
        newlyCompletedGameCount:
          results.reduce(
            (total, result) =>
              total +
              result.newlyCompletedGameCount,
            0
          )
      },
      results
    });
  } catch (err) {
    console.error(
      'Game status observer error:',
      err
    );

    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
};