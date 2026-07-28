import supabase from '../lib/supabase.js';

export default async function handler(req, res) {
  try {
    const requestedSport =
      req.query.sport ||
      'baseball_mlb';

    const { data, error } = await supabase
      .from('odds_snapshots')
      .select(
        `
          sport,
          payload,
          schema_version,
          fetched_at,
          last_success_at,
          last_error
        `
      )
      .eq('sport', requestedSport)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({
        error: 'Odds snapshot not found',
        sport: requestedSport
      });
    }

    if (!data.payload) {
      return res.status(500).json({
        error: 'Stored odds snapshot has no payload',
        sport: requestedSport
      });
    }

    res.setHeader(
      'X-Snapshot-Fetched-At',
      data.fetched_at || ''
    );

    res.setHeader(
      'X-Snapshot-Schema-Version',
      String(data.schema_version || 1)
    );

    res.setHeader(
      'Cache-Control',
      'no-store'
    );

    return res.status(200).json(data.payload);
  } catch (err) {
    console.error(
      'ODDS SNAPSHOT READ ERROR:',
      err
    );

    return res.status(500).json({
      error: 'Failed to read odds snapshot',
      details: err.message
    });
  }
}