import { buildOddsPayload } from '../lib/build-odds-payload.js';
import redis, {
  getOddsSnapshotKey,
  getCurrentEspnStatusKey,
  getOddsSnapshotScheduleKey
} from '../lib/redis.js';

const DEBUG_SNAPSHOT = true;

const SNAPSHOT_SPORTS = [
  'baseball_mlb',
  'basketball_wnba',
  'soccer_usa_mls',
  'americanfootball_nfl',
  'americanfootball_ncaaf',
  'basketball_ncaab',
  'basketball_wncaab',
  'basketball_nba'
];

const SNAPSHOT_POLLING_MODE = 'conservative';

const SNAPSHOT_SCHEDULE_STALE_MS =
  24 * 60 * 60 * 1000;

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
  live: 2 * 60 * 1000,
  delayed: 5 * 60 * 1000,
  suspended: 15 * 60 * 1000,
  within10Minutes: 2 * 60 * 1000,
  within60Minutes: 5 * 60 * 1000,
  within3Hours: 10 * 60 * 1000,
  within6Hours: 15 * 60 * 1000,
  within12Hours: 20 * 60 * 1000,
  within18Hours: 30 * 60 * 1000,
  within24Hours: 45 * 60 * 1000,
  within72Hours: 60 * 60 * 1000,
  within7Days: 4 * 60 * 60 * 1000,
  farFuture: 8 * 60 * 60 * 1000,
  idle: 8 * 60 * 60 * 1000
};

const SNAPSHOT_POLLING =
  SNAPSHOT_POLLING_MODE === 'aggressive'
    ? AGGRESSIVE_POLLING
    : CONSERVATIVE_POLLING;

function getSnapshotPollingInterval(
  payload,
  ignoreSnapshotCurrentStatus = false,
  postponedGameIds = new Set()
) {
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

    if (
    !ignoreSnapshotCurrentStatus &&
    hasLiveGame
  ) {
    return SNAPSHOT_POLLING.live;
  }

      const minutesUntilNextGame = games.reduce(
        (closest, game) => {
          const espnGameId =
            String(game?.espnStatus?.id || '');

          if (
            espnGameId &&
            postponedGameIds.has(espnGameId)
          ) {
            return closest;
          }

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

      const minutesUntilStart =
        (startTime - now) / 60000;

      return Math.min(
        closest,
        minutesUntilStart
      );
    },
    Infinity
  );

  if (minutesUntilNextGame <= 10) {
    return SNAPSHOT_POLLING.within10Minutes;
  }

  if (minutesUntilNextGame <= 60) {
    return SNAPSHOT_POLLING.within60Minutes;
  }

const hasPastStartPregame = games.some(game => {
  const espn = game?.espnStatus;

  const espnState =
    String(espn?.statusState || '').toLowerCase();

  const espnStatusText = String(
    `${espn?.statusName || ''} ` +
    `${espn?.statusDescription || ''} ` +
    `${espn?.statusDetail || ''}`
  ).toLowerCase();

  const hasExceptionalStatus =
    espnStatusText.includes('delay') ||
    espnStatusText.includes('suspend') ||
    espnStatusText.includes('postpon');

  const startTime = new Date(
    game.commence_time ||
    game.commenceTime ||
    game.startTime
  ).getTime();

  if (
    espnState !== 'pre' ||
    hasExceptionalStatus ||
    !Number.isFinite(startTime)
  ) {
    return false;
  }

  const minutesSinceStart =
    (now - startTime) / 60000;

  return (
    minutesSinceStart >= 0 &&
    minutesSinceStart <= 15
  );
});

if (
  !ignoreSnapshotCurrentStatus &&
  hasPastStartPregame
) {
  return SNAPSHOT_POLLING.live;
}

    const hoursUntilNextGame = games.reduce(
    (closest, game) => {
      const espnGameId =
        String(game?.espnStatus?.id || '');

      if (
        espnGameId &&
        postponedGameIds.has(espnGameId)
      ) {
        return closest;
      }

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

if (hoursUntilNextGame <= 6) {
  return SNAPSHOT_POLLING.within6Hours;
}

if (hoursUntilNextGame <= 12) {
  return SNAPSHOT_POLLING.within12Hours;
}

if (hoursUntilNextGame <= 18) {
  return SNAPSHOT_POLLING.within18Hours;
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

function getCurrentEspnPollingState(
  currentEspnStatus = null
) {
  const currentEspnUpdatedAt =
    new Date(
      currentEspnStatus?.updatedAt || 0
    ).getTime();

  const hasFreshCurrentEspnStatus =
    Number.isFinite(currentEspnUpdatedAt) &&
    currentEspnUpdatedAt > 0 &&
    Date.now() - currentEspnUpdatedAt <=
      5 * 60 * 1000;

  const currentEspnGames =
    hasFreshCurrentEspnStatus &&
    Array.isArray(currentEspnStatus?.games)
      ? currentEspnStatus.games
      : [];

  const hasCurrentLiveGame =
    currentEspnGames.some(game => {
      const state = String(
        game?.statusState || ''
      ).toLowerCase();

      const statusText = String(
        `${game?.statusName || ''} ` +
        `${game?.statusDescription || ''} ` +
        `${game?.statusDetail || ''}`
      ).toLowerCase();

      return (
        state === 'in' &&
        !statusText.includes('delay') &&
        !statusText.includes('suspend') &&
        !statusText.includes('postpon')
      );
    });

  const hasCurrentDelayedGame =
    currentEspnGames.some(game => {
      const statusText = String(
        `${game?.statusName || ''} ` +
        `${game?.statusDescription || ''} ` +
        `${game?.statusDetail || ''}`
      ).toLowerCase();

      return statusText.includes('delay');
    });

  const hasCurrentSuspendedGame =
    currentEspnGames.some(game => {
      const statusText = String(
        `${game?.statusName || ''} ` +
        `${game?.statusDescription || ''} ` +
        `${game?.statusDetail || ''}`
      ).toLowerCase();

      return statusText.includes('suspend');
    });

  const currentPostponedGameIds =
    new Set(
      currentEspnGames
        .filter(game => {
          const statusText = String(
            `${game?.statusName || ''} ` +
            `${game?.statusDescription || ''} ` +
            `${game?.statusDetail || ''}`
          ).toLowerCase();

          return statusText.includes('postpon');
        })
        .map(game =>
          String(game?.id || '')
        )
        .filter(Boolean)
    );

  return {
    hasFreshCurrentEspnStatus,
    hasCurrentLiveGame,
    hasCurrentDelayedGame,
    hasCurrentSuspendedGame,
    currentPostponedGameIds
  };
}

function getSnapshotNextDueAt(
  snapshotRow,
  currentEspnStatus = null
) {
  if (!snapshotRow) {
    return Date.now();
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
    return Date.now();
  }

  const {
    hasFreshCurrentEspnStatus,
    hasCurrentLiveGame,
    hasCurrentDelayedGame,
    hasCurrentSuspendedGame,
    currentPostponedGameIds
  } = getCurrentEspnPollingState(
    currentEspnStatus
  );

  const pollInterval =
    hasCurrentLiveGame
      ? SNAPSHOT_POLLING.live
      : hasCurrentDelayedGame
      ? SNAPSHOT_POLLING.delayed
      : hasCurrentSuspendedGame
      ? SNAPSHOT_POLLING.suspended
      : getSnapshotPollingInterval(
          payload,
          hasFreshCurrentEspnStatus,
          currentPostponedGameIds
        );

  return fetchedAt + pollInterval;
}

function isSnapshotDue(
  snapshotRow,
  currentEspnStatus = null
) {
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

  const {
    hasFreshCurrentEspnStatus,
    hasCurrentLiveGame,
    hasCurrentDelayedGame,
    hasCurrentSuspendedGame,
    currentPostponedGameIds
  } = getCurrentEspnPollingState(
    currentEspnStatus
  );

    const pollInterval =
    hasCurrentLiveGame
      ? SNAPSHOT_POLLING.live
      : hasCurrentDelayedGame
      ? SNAPSHOT_POLLING.delayed
            : hasCurrentSuspendedGame
      ? SNAPSHOT_POLLING.suspended
         : getSnapshotPollingInterval(
          payload,
          hasFreshCurrentEspnStatus,
          currentPostponedGameIds
        );

  return (
    Date.now() - fetchedAt >= pollInterval
  );
}

async function getOddsSnapshotSchedule() {
  try {
    return (
      await redis.get(
        getOddsSnapshotScheduleKey()
      )
    ) || null;
  } catch (redisError) {
    console.error(
      'REDIS ODDS SNAPSHOT SCHEDULE READ FAILED:',
      redisError
    );

    return null;
  }
}

async function setOddsSnapshotSchedule(schedule) {
  try {
    await redis.set(
      getOddsSnapshotScheduleKey(),
      schedule
    );
  } catch (redisError) {
    console.error(
      'REDIS ODDS SNAPSHOT SCHEDULE WRITE FAILED:',
      redisError
    );

    throw redisError;
  }
}


async function getStoredSnapshotRow(sport) {
  try {
    const redisPayload =
      await redis.get(
        getOddsSnapshotKey(sport)
      );

    if (redisPayload) {
      const snapshotTime =
        redisPayload.snapshotGeneratedAt || null;

      return {
        sport,
        payload: redisPayload,
        fetched_at: snapshotTime,
        last_success_at: snapshotTime
      };
    }
  } catch (redisError) {
    console.error(
      'REDIS SNAPSHOT READ FAILED:',
      sport,
      redisError
    );

    throw redisError;
  }

    return null;
}

async function getCurrentEspnStatus(sport) {
  try {
    return (
      await redis.get(
        getCurrentEspnStatusKey(sport)
      )
    ) || null;
  } catch (redisError) {
    console.error(
      'REDIS ESPN STATUS READ FAILED:',
      sport,
      redisError
    );

    return null;
  }
}

async function getDueSnapshotSports() {
  const dueSports = [];

  const storedSchedule =
    await getOddsSnapshotSchedule();

  const schedule =
    storedSchedule &&
    typeof storedSchedule === 'object'
      ? { ...storedSchedule }
      : {};

  const hasCompleteSchedule =
    storedSchedule &&
    typeof storedSchedule === 'object' &&
    SNAPSHOT_SPORTS.every(sport => {
            const nextDueAt =
        Number(storedSchedule[sport]);

      return (
        Number.isFinite(nextDueAt) &&
        nextDueAt > 0 &&
        nextDueAt >=
          Date.now() -
            SNAPSHOT_SCHEDULE_STALE_MS
      );
    });

    console.log(
    'ODDS SNAPSHOT SCHEDULE CHECK:',
    {
      hasCompleteSchedule
    }
  );

  const sportsToCheck =
    hasCompleteSchedule
      ? SNAPSHOT_SPORTS.filter(
          sport =>
            Number(storedSchedule[sport]) <=
            Date.now()
        )
      : SNAPSHOT_SPORTS;

  console.log(
    'ODDS SNAPSHOT SPORTS TO CHECK:',
    sportsToCheck
  );

  for (const sport of sportsToCheck) {
    const snapshotRow =
      await getStoredSnapshotRow(sport);

    const currentEspnStatus =
      await getCurrentEspnStatus(sport);

    const snapshotDue =
      isSnapshotDue(
        snapshotRow,
        currentEspnStatus
      );

    schedule[sport] =
      getSnapshotNextDueAt(
        snapshotRow,
        currentEspnStatus
      );

    if (snapshotDue) {
          dueSports.push(sport);
      }
    }

if (sportsToCheck.length > 0) {
    await setOddsSnapshotSchedule(schedule);
}

  return dueSports;
}

async function prepareSportSnapshot(
  sport,
  forceRefresh = false
) {
    const previousSnapshot =
    await getStoredSnapshotRow(sport);

  const currentEspnStatus =
    await getCurrentEspnStatus(sport);

    if (
    !forceRefresh &&
    !isSnapshotDue(
      previousSnapshot,
      currentEspnStatus
    )
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

          espnStatus: game?.espnStatus
            ? {
                statusName:
                  game.espnStatus.statusName ?? null,
                statusState:
                  game.espnStatus.statusState ?? null,
                statusDescription:
                  game.espnStatus.statusDescription ?? null
              }
            : null,

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

  await redis.set(
    getOddsSnapshotKey(sport),
    snapshotPayload
  );

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
    return {
      ok: true,
      sport,
      snapshotChanged: false,
      snapshotSkipped: false,
      message: 'Odds snapshot unchanged — Redis remains current.',
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

  return {
    ok: true,
    sport,
    snapshotChanged: true,
    snapshotSkipped: false,
    message: 'Odds snapshot saved to Redis successfully.',
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

    return res.status(500).json({
      ok: false,
      error: 'Failed to update odds snapshot',
      details: err.message
    });
  }
}