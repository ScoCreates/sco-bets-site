function normalizeTeamName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function mapSportToEspn(sport) {
  const map = {
    baseball_mlb: 'baseball/mlb',
    basketball_nba: 'basketball/nba',
    basketball_wnba: 'basketball/wnba',
    basketball_ncaab: 'basketball/mens-college-basketball',
    soccer_usa_mls: 'soccer/usa.1',
    americanfootball_nfl: 'football/nfl'
  };

  return map[sport] || 'baseball/mlb';
}

export default async function handler(req, res) {
  try {
    const sport = req.query.sport || 'baseball_mlb';
    const espnSportPath = mapSportToEspn(sport);

    const requestedDate = req.query.date;
    const dateParam = requestedDate ? `?dates=${requestedDate}` : '';
    const url = `https://site.api.espn.com/apis/site/v2/sports/${espnSportPath}/scoreboard${dateParam}`;

    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: 'ESPN scoreboard request failed',
        details: text
      });
    }

    const data = await response.json();

    const games = (data.events || []).map(event => {
      const competition = event.competitions?.[0];
      const competitors = competition?.competitors || [];

      const home = competitors.find(c => c.homeAway === 'home');
      const away = competitors.find(c => c.homeAway === 'away');

      const status = event.status || {};
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
        period: status.period || null,
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
        homeScore: home?.score ?? null,
        awayScore: away?.score ?? null,

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

        gameKey: `${normalizeTeamName(away?.team?.displayName)}_${normalizeTeamName(home?.team?.displayName)}_${String(event.date || '').slice(0, 10)}`
      };
    });

    return res.status(200).json({
      sport,
      provider: 'espn',
      count: games.length,
      games
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to load ESPN scores',
      details: err.message
    });
  }
}