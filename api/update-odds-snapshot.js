import { buildOddsPayload } from '../lib/build-odds-payload.js';
import supabase from '../lib/supabase.js';

const DEBUG_SNAPSHOT = true;

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

  const requestedSport =
    req.query.sport ||
    'baseball_mlb';

  try {
   let previousGames = [];

   const { data: previousSnapshot } =
     await supabase
      .from('odds_snapshots')
      .select('payload')
      .eq('sport', requestedSport)
      .maybeSingle();

   if (
     previousSnapshot?.payload?.games &&
     Array.isArray(previousSnapshot.payload.games)
   ) {
     previousGames =
       previousSnapshot.payload.games;
   }
    const payload =
      await buildOddsPayload(
        requestedSport,
        previousGames
      );

    const snapshotTime =
      new Date().toISOString();

    const snapshotPayload = {
      schemaVersion: 1,
      ...payload,
      snapshotGeneratedAt: snapshotTime
    };
	
const makeComparablePayload = (sourcePayload) => {
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
};

const previousComparablePayload =
  makeComparablePayload(previousSnapshot?.payload);

const currentComparablePayload =
  makeComparablePayload(snapshotPayload);
  
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

const firstDifference =
  findFirstDifference(
    previousComparablePayload,
    currentComparablePayload
  );

const snapshotChanged =
  firstDifference !== null;

if (DEBUG_SNAPSHOT) {
  const pacificTime = new Date().toLocaleString(
    'en-US',
    {
      timeZone: 'America/Los_Angeles',
      hour12: true
    }
  );
const makeGameDebugKey = (game) =>
  `${game?.away || ''} vs ${game?.home || ''} | ${game?.commence_time || ''}`;

const previousGameKeys = new Set(
  (previousComparablePayload?.games || []).map(makeGameDebugKey)
);

const currentGameKeys = new Set(
  (currentComparablePayload?.games || []).map(makeGameDebugKey)
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
Sport: ${requestedSport}
Changed: ${snapshotChanged}
First Difference: ${firstDifference ?? 'None'}
Previous Games: ${previousComparablePayload?.games?.length ?? 0}
Current Games: ${currentComparablePayload?.games?.length ?? 0}
Added Games: ${addedGames.length ? addedGames.join(' || ') : 'None'}
Removed Games: ${removedGames.length ? removedGames.join(' || ') : 'None'}
========================================
`);
}

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
  return res.status(200).json({
    ok: true,
    snapshotChanged: false,
    message: 'Odds snapshot unchanged — database write skipped.',
    totalGames: payload.totalGames,
    gameCount: Array.isArray(payload.games)
      ? payload.games.length
      : 0,
    completedGameCount:
      Array.isArray(payload.completedGames)
        ? payload.completedGames.length
        : 0
  });
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

    return res.status(200).json({
      ok: true,
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
    });
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