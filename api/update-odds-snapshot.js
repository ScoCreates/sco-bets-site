import { buildOddsPayload } from '../lib/build-odds-payload.js';
import supabase from '../lib/supabase.js';

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