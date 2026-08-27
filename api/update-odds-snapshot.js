import { buildOddsPayload } from '../lib/build-odds-payload.js';
import supabase from '../lib/supabase.js';

const DEBUG_SNAPSHOT = true;

const SNAPSHOT_SPORTS = [
  'baseball_mlb',
  'basketball_wnba',
  'soccer_usa_mls',
  'americanfootball_nfl',
  'americanfootball_ncaaf'
];

const SNAPSHOT_POLLING_MODE = 'conservative';

const AGGRESSIVE_POLLING = {
  live: 60 * 1000,
  startingSoon: 60 * 1000,
  within3Hours: 2 * 60 * 1000,
  within12Hours: 2 * 60 * 1000,
  within24Hours: 2 * 60 * 1000,
  within72Hours: 2 * 60 * 1000,
  within7Days: 5 * 60 * 1000,
  farFuture: 15 * 60 * 1000,
  idle: 15 * 60 * 1000
};

const CONSERVATIVE_POLLING = {
  live: 60 * 1000,
  startingSoon: 60 * 1000,
  within3Hours: 5 * 60 * 1000,
  within12Hours: 10 * 60 * 1000,
  within24Hours: 30 * 60 * 1000,
  within72Hours: 60 * 60 * 1000,
  within7Days: 4 * 60 * 60 * 1000,
  farFuture: 8 * 60 * 60 * 1000,
  idle: 8 * 60 * 60 * 1000
};

const SNAPSHOT_POLLING =
  SNAPSHOT_POLLING_MODE === 'aggressive'
    ? AGGRESSIVE_POLLING
    : CONSERVATIVE_POLLING;

function getSnapshotPollingInterval(payload) {
  const games = Array.isArray(payload?.games)
    ? payload.games
    : [];

  const now = Date.now();

  const hasLiveGame = games.some(game => {
    const espn = game?.espnStatus;

    return (
      espn?.statusState === 'in' &&
      !String(
        espn?.statusDescription || ''
      )
        .toLowerCase()
        .includes('delay')
    );
  });

  if (hasLiveGame) {
    return SNAPSHOT_POLLING.live;
  }

  const hasStartingSoonGame = games.some(game => {
    const startTime = new Date(
      game.commence_time ||
      game.commenceTime ||
      game.startTime
    ).getTime();

    if (!Number.isFinite(startTime)) {
      return false;
    }

    const minutesUntilStart =
      (startTime - now) / 60000;

    return (
      minutesUntilStart > 0 &&
      minutesUntilStart <= 120
    );
  });

  if (hasStartingSoonGame) {
    return SNAPSHOT_POLLING.startingSoon;
  }

  const hoursUntilNextGame = games.reduce(
    (closest, game) => {
      const startTime = new Date(
        game.commence_time ||
        game.commenceTime ||
        game.startTime
      ).getTime();

      if (
        !Number.isFinite(startTime) ||
        startTime <= now
      ) {
        return closest;
      }

      const hoursUntilStart =
        (startTime - now) /
        (60 * 60 * 1000);

      return Math.min(
        closest,
        hoursUntilStart
      );
    },
    Infinity
  );

  if (SNAPSHOT_POLLING_MODE === 'aggressive') {
    if (hoursUntilNextGame <= 72) {
      return SNAPSHOT_POLLING.within72Hours;
    }

    if (hoursUntilNextGame <= 168) {
      return SNAPSHOT_POLLING.within7Days;
    }

    if (Number.isFinite(hoursUntilNextGame)) {
      return SNAPSHOT_POLLING.farFuture;
    }

    return SNAPSHOT_POLLING.idle;
  }

if (hoursUntilNextGame <= 3) {
  return SNAPSHOT_POLLING.within3Hours;
}

if (hoursUntilNextGame <= 12) {
  return SNAPSHOT_POLLING.within12Hours;
}

if (hoursUntilNextGame <= 24) {
  return SNAPSHOT_POLLING.within24Hours;
}

if (hoursUntilNextGame <= 72) {
  return SNAPSHOT_POLLING.within72Hours;
}

if (hoursUntilNextGame <= 168) {
  return SNAPSHOT_POLLING.within7Days;
}

if (Number.isFinite(hoursUntilNextGame)) {
  return SNAPSHOT_POLLING.farFuture;
}

return SNAPSHOT_POLLING.idle;
}

function isSnapshotDue(snapshotRow) {
  if (!snapshotRow) {
    return true;
  }

  const payload = snapshotRow.payload || null;

  const fetchedAt = new Date(
    snapshotRow.fetched_at ||
    snapshotRow.last_success_at ||
    0
  ).getTime();

  if (
    !Number.isFinite(fetchedAt) ||
    fetchedAt <= 0
  ) {
    return true;
  }

  const pollInterval =
    getSnapshotPollingInterval(payload);

  return (
    Date.now() - fetchedAt >= pollInterval
  );
}

async function getStoredSnapshotRow(sport) {
  const { data, error } = await supabase
    .from('odds_snapshots')
    .select(`
      sport,
      payload,
      fetched_at,
      last_success_at
    `)
    .eq('sport', sport)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

async function getDueSnapshotSports() {
  const dueSports = [];

  for (const sport of SNAPSHOT_SPORTS) {
    const snapshotRow =
      await getStoredSnapshotRow(sport);

    if (isSnapshotDue(snapshotRow)) {
      dueSports.push(sport);
    }
  }

  return dueSports;
}

async function prepareSportSnapshot(
  sport,
  forceRefresh = false
) {
  const previousSnapshot =
    await getStoredSnapshotRow(sport);

  if (
    !forceRefresh &&
    !isSnapshotDue(previousSnapshot)
  ) {
    return {
      skipped: true,
      previousSnapshot,
      previousGames: []
    };
  }

  const previousGames =
    previousSnapshot?.payload?.games &&
    Array.isArray(previousSnapshot.payload.games)
      ? previousSnapshot.payload.games
      : [];

  return {
    skipped: false,
    previousSnapshot,
    previousGames
  };
}

function makeComparablePayload(sourcePayload) {
  if (!sourcePayload) {
    return null;
  }

  const comparableGames = Array.isArray(sourcePayload.games)
    ? sourcePayload.games
        .map(game => ({
          ...game,

          bookmakers: Array.isArray(game.bookmakers)
            ? game.bookmakers
                .map(bookmaker => ({
                  ...bookmaker,
                  lastUpdate: undefined,

                  odds: Array.isArray(bookmaker.odds)
                    ? bookmaker.odds
                        .map(odd => ({
                          ...odd,
                          edge: undefined
                        }))
                        .sort((a, b) => {
                          const aKey = String(
                            a.name ||
                            a.team ||
                            a.title ||
                            ''
                          );

                          const bKey = String(
                            b.name ||
                            b.team ||
                            b.title ||
                            ''
                          );

                          return aKey.localeCompare(bKey);
                        })
                    : []
                }))
                .sort((a, b) =>
                  String(a.title || '').localeCompare(
                    String(b.title || '')
                  )
                )
            : []
        }))
        .sort((a, b) => {
          const aKey =
            `${a.away || ''}|${a.home || ''}|${a.commence_time || ''}`;

          const bKey =
            `${b.away || ''}|${b.home || ''}|${b.commence_time || ''}`;

          return aKey.localeCompare(bKey);
        })
    : [];

  return {
    ...sourcePayload,
    snapshotGeneratedAt: undefined,
    debug: undefined,
    games: comparableGames
  };
}

function findFirstDifference(a, b, path = 'payload') {
  if (a === b) {
    return null;
  }

  if (
    a === null ||
    b === null ||
    typeof a !== 'object' ||
    typeof b !== 'object'
  ) {
    return path;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      return path;
    }

    if (a.length !== b.length) {
      return `${path}.length`;
    }

    for (let i = 0; i < a.length; i++) {
      const difference = findFirstDifference(
        a[i],
        b[i],
        `${path}[${i}]`
      );

      if (difference) {
        return difference;
      }
    }

    return null;
  }

  const keys = new Set([
    ...Object.keys(a),
    ...Object.keys(b)
  ]);

  for (const key of keys) {
    const difference = findFirstDifference(
      a[key],
      b[key],
      `${path}.${key}`
    );

    if (difference) {
      return difference;
    }
  }

  return null;
}

function makeGameDebugKey(game) {
  return `${game?.away || ''} vs ${game?.home || ''} | ${game?.commence_time || ''}`;
}

function logSnapshotDebug(
  sport,
  snapshotChanged,
  firstDifference,
  previousComparablePayload,
  currentComparablePayload
) {
  if (!DEBUG_SNAPSHOT) {
    return;
  }

  const pacificTime = new Date().toLocaleString(
    'en-US',
    {
      timeZone: 'America/Los_Angeles',
      hour12: true
    }
  );

  const previousGameKeys = new Set(
    (previousComparablePayload?.games || [])
      .map(makeGameDebugKey)
  );

  const currentGameKeys = new Set(
    (currentComparablePayload?.games || [])
      .map(makeGameDebugKey)
  );

  const addedGames =
    [...currentGameKeys].filter(
      gameKey => !previousGameKeys.has(gameKey)
    );

  const removedGames =
    [...previousGameKeys].filter(
      gameKey => !currentGameKeys.has(gameKey)
    );

  console.log(`
========================================
ODDS SNAPSHOT WRITE CHECK
Time: ${pacificTime}
Sport: ${sport}
Changed: ${snapshotChanged}
First Difference: ${firstDifference ?? 'None'}
Previous Games: ${previousComparablePayload?.games?.length ?? 0}
Current Games: ${currentComparablePayload?.games?.length ?? 0}
Added Games: ${addedGames.length ? addedGames.join(' || ') : 'None'}
Removed Games: ${removedGames.length ? removedGames.join(' || ') : 'None'}
========================================
`);
}

async function updateSportSnapshot(
  sport,
  forceRefresh = false
) {
  const {
    skipped,
    previousSnapshot,
    previousGames
  } = await prepareSportSnapshot(
    sport,
    forceRefresh
  );

  if (skipped) {
    return {
      ok: true,
      sport,
      snapshotChanged: false,
      snapshotSkipped: true,
      message: 'Odds snapshot is still fresh — upstream refresh skipped.'
    };
  }

  const payload =
    await buildOddsPayload(
      sport,
      previousGames
    );

  const snapshotTime =
    new Date().toISOString();

  const snapshotPayload = {
    schemaVersion: 1,
    ...payload,
    snapshotGeneratedAt: snapshotTime
  };

  const previousComparablePayload =
    makeComparablePayload(
      previousSnapshot?.payload
    );

  const currentComparablePayload =
    makeComparablePayload(
      snapshotPayload
    );

  const firstDifference =
    findFirstDifference(
      previousComparablePayload,
      currentComparablePayload
    );

  const snapshotChanged =
    firstDifference !== null;

  logSnapshotDebug(
    sport,
    snapshotChanged,
    firstDifference,
    previousComparablePayload,
    currentComparablePayload
  );

  if (
    firstDifference &&
    firstDifference.includes('.bookmakers.length')
  ) {
    const match =
      firstDifference.match(/games\[(\d+)\]/);

    const gameIndex = match
      ? Number(match[1])
      : null;

    if (Number.isInteger(gameIndex)) {
      const previousGame =
        previousComparablePayload?.games?.[gameIndex];

      const currentGame =
        currentComparablePayload?.games?.[gameIndex];

      console.log('BOOKMAKER LENGTH DIFFERENCE:', {
        gameIndex,

        previousGame:
          `${previousGame?.away || ''} vs ${previousGame?.home || ''}`,

        currentGame:
          `${currentGame?.away || ''} vs ${currentGame?.home || ''}`,

        previousBookmakers:
          previousGame?.bookmakers?.map(
            bookmaker => bookmaker.title
          ) || [],

        currentBookmakers:
          currentGame?.bookmakers?.map(
            bookmaker => bookmaker.title
          ) || []
      });
    }
  }

  if (!snapshotChanged) {
  const { error: freshnessUpdateError } =
    await supabase
      .from('odds_snapshots')
      .update({
        payload: snapshotPayload,
        schema_version: 1,
        fetched_at: snapshotTime,
        last_success_at: snapshotTime,
        last_error: null,
        updated_at: snapshotTime
      })
      .eq('sport', sport);

  if (freshnessUpdateError) {
    throw freshnessUpdateError;
  }

  return {
    ok: true,
    sport,
    snapshotChanged: false,
    snapshotSkipped: false,
    message: 'Odds snapshot unchanged — freshness timestamp updated.',
    totalGames: payload.totalGames,
    gameCount: Array.isArray(payload.games)
      ? payload.games.length
      : 0,
    completedGameCount:
      Array.isArray(payload.completedGames)
        ? payload.completedGames.length
        : 0
  };
}

  const { data, error } = await supabase
    .from('odds_snapshots')
    .upsert(
      {
        sport: payload.sport,
        payload: snapshotPayload,
        schema_version: 1,
        fetched_at: snapshotTime,
        last_success_at: snapshotTime,
        last_error: null,
        updated_at: snapshotTime
      },
      {
        onConflict: 'sport'
      }
    )
    .select('sport, schema_version, fetched_at, last_success_at')
    .single();

  if (error) {
    throw error;
  }

  return {
    ok: true,
    sport,
    snapshotChanged: true,
    snapshotSkipped: false,
    message: 'Odds snapshot saved successfully.',
    snapshot: data,
    totalGames: payload.totalGames,
    gameCount: Array.isArray(payload.games)
      ? payload.games.length
      : 0,
    completedGameCount:
      Array.isArray(payload.completedGames)
        ? payload.completedGames.length
        : 0
  };
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;

if (!cronSecret) {
    return res.status(500).json({
      ok: false,
      error: 'Missing CRON_SECRET'
    });
  }

  if (
    req.headers.authorization !== `Bearer ${cronSecret}`
  ) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized'
    });
  }

const explicitlyRequestedSport =
  String(req.query.sport || '').trim();

const requestedSport =
  explicitlyRequestedSport ||
  'baseball_mlb';

const forceRefresh =
  Boolean(explicitlyRequestedSport);
  
 if (!explicitlyRequestedSport) {
  const dueSports =
    await getDueSnapshotSports();

  const results = [];

  for (const sport of dueSports) {
    try {
      const result =
        await updateSportSnapshot(
          sport,
          false
        );

      results.push(result);
    } catch (err) {
      console.error(
        `ODDS SNAPSHOT UPDATE FAILED FOR ${sport}:`,
        err
      );

      try {
        await supabase
          .from('odds_snapshots')
          .update({
            last_error: err.message,
            updated_at: new Date().toISOString()
          })
          .eq('sport', sport);
      } catch (storageErr) {
        console.error(
          `FAILED TO RECORD SNAPSHOT ERROR FOR ${sport}:`,
          storageErr
        );
      }

      results.push({
        ok: false,
        sport,
        error: err.message
      });
    }
  }

  return res.status(200).json({
    ok: true,
    mode: 'scheduler',
    dueSports,
    updatedSports: results
  });
} 

try {
 const sportUpdate =
  await updateSportSnapshot(
    requestedSport,
    forceRefresh
  );

return res.status(200).json(
  sportUpdate
);
  } catch (err) {
    console.error(
      'UPDATE ODDS SNAPSHOT ERROR:',
      err
    );

    try {
      await supabase
        .from('odds_snapshots')
        .update({
          last_error: err.message,
          updated_at: new Date().toISOString()
        })
        .eq('sport', requestedSport);
    } catch (storageErr) {
      console.error(
        'FAILED TO RECORD SNAPSHOT ERROR:',
        storageErr
      );
    }

    return res.status(500).json({
      ok: false,
      error: 'Failed to update odds snapshot',
      details: err.message
    });
  }
}