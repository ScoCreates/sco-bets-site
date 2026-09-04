import redis, { getOddsSnapshotKey } from '../lib/redis.js';

export default async function handler(req, res) {
  try {
    const requestedSport =
      req.query.sport ||
      'baseball_mlb';

    const redisPayload =
      await redis.get(
        getOddsSnapshotKey(requestedSport)
      );

    if (!redisPayload) {
      return res.status(404).json({
        error: 'Odds snapshot not available',
        sport: requestedSport
      });
    }

    res.setHeader(
      'X-Snapshot-Fetched-At',
      redisPayload.snapshotGeneratedAt || ''
    );

    res.setHeader(
      'X-Snapshot-Schema-Version',
      String(redisPayload.schemaVersion || 1)
    );

    res.setHeader(
      'Cache-Control',
      'no-store'
    );

    return res.status(200).json(redisPayload);
  } catch (err) {
    console.error(
      'REDIS ODDS SNAPSHOT READ ERROR:',
      err
    );

    return res.status(503).json({
      error: 'Live odds snapshot temporarily unavailable',
      details: err.message
    });
  }
}