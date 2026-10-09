import redis, { getMlbSeriesScheduleKey } from '../lib/redis.js';

const CACHE_SECONDS = 300;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cacheKey = getMlbSeriesScheduleKey();

  try {
    const cached = await redis.get(cacheKey);

    if (cached && Array.isArray(cached.games)) {
      return res.status(200).json(cached);
    }

    const now = new Date();
    const startDate = new Date(now);
    const endDate = new Date(now);

    startDate.setUTCDate(startDate.getUTCDate() - 1);
    endDate.setUTCDate(endDate.getUTCDate() + 14);

    const formatDate = date => date.toISOString().slice(0, 10);

    const url = new URL('https://statsapi.mlb.com/api/v1/schedule');

    url.searchParams.set('sportId', '1');
    url.searchParams.set('startDate', formatDate(startDate));
    url.searchParams.set('endDate', formatDate(endDate));
    url.searchParams.set('hydrate', 'seriesStatus');

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`MLB schedule returned ${response.status}`);
    }

    const schedule = await response.json();
    const games = [];

    for (const date of schedule.dates || []) {
      for (const game of date.games || []) {
        const series = game.seriesStatus;

        if (
          game.recordSource !== 'S' ||
          !series ||
          !Number.isFinite(Number(series.gameNumber))
        ) {
          continue;
        }

        games.push({
          gamePk: game.gamePk,
          gameDate: game.gameDate,
          awayTeam: game.teams?.away?.team?.name,
          homeTeam: game.teams?.home?.team?.name,
          mlbSeriesDescription: game.seriesDescription || series.description,
          mlbSeriesGameNumber: Number(series.gameNumber),
          mlbSeriesRecordSource: game.recordSource,
          mlbSeriesAwayWins: Number(game.teams?.away?.leagueRecord?.wins ?? 0),
          mlbSeriesAwayLosses: Number(game.teams?.away?.leagueRecord?.losses ?? 0),
          mlbSeriesHomeWins: Number(game.teams?.home?.leagueRecord?.wins ?? 0),
          mlbSeriesHomeLosses: Number(game.teams?.home?.leagueRecord?.losses ?? 0)
        });
      }
    }

    const payload = {
      fetchedAt: new Date().toISOString(),
      games
    };

    await redis.set(cacheKey, payload, {
      ex: CACHE_SECONDS
    });

    return res.status(200).json(payload);
  } catch (error) {
    console.error('MLB SERIES SCHEDULE ERROR:', error);

    return res.status(500).json({
      error: 'Unable to retrieve MLB series schedule'
    });
  }
}