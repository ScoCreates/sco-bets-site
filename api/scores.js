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
    americanfootball_nfl: 'football/nfl',
    americanfootball_ncaaf: 'football/college-football'
  };

  return map[sport] || 'baseball/mlb';
}

export default async function handler(req, res) {
  try {
    const sport = req.query.sport || 'baseball_mlb';
    const espnSportPath = mapSportToEspn(sport);

    const requestedDate = req.query.date;

    let effectiveDate = requestedDate;

    if (!effectiveDate && sport === 'americanfootball_ncaaf') {
      const now = new Date();

      const easternDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(now);

      effectiveDate = easternDate.replace(/-/g, '');
    }

    const dateParam = effectiveDate ? `?dates=${effectiveDate}` : '';
    const url = `https://site.api.espn.com/apis/site/v2/sports/${espnSportPath}/scoreboard${dateParam}`;

    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache'
      }
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: 'ESPN scoreboard request failed',
        details: text
      });
    }

    const data = await response.json();

const mlsClockAnchors = {};
const footballLatestPlays = {};

if (sport === 'soccer_usa_mls') {
  const liveMlsEvents = (data.events || []).filter(
    event => event.status?.type?.state === 'in'
  );

  await Promise.all(
    liveMlsEvents.map(async event => {
      try {
        const summaryUrl =
          `https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/summary?event=${event.id}`;

        const summaryResponse = await fetch(summaryUrl, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache'
          }
        });

        if (!summaryResponse.ok) return;

        const summaryData = await summaryResponse.json();

        const latestWithWallclock = [...(summaryData.commentary || [])]
          .reverse()
          .find(item =>
            item?.play?.wallclock &&
            Number.isFinite(
              Number(item?.play?.clock?.value ?? item?.time?.value)
            )
          );

        if (!latestWithWallclock) return;

        mlsClockAnchors[event.id] = {
          clockSeconds: Number(
            latestWithWallclock.play?.clock?.value ??
            latestWithWallclock.time?.value
          ),
          wallclock: latestWithWallclock.play.wallclock
        };
      } catch (err) {
        // Keep normal ESPN scoreboard data if a summary lookup fails.
      }
    })
  );
}

const wnbaLatestPlays = {};

const liveWnbaEvents =
  sport === 'basketball_wnba'
    ? (data.events || []).filter(
        event => event.status?.type?.state === 'in'
      )
    : [];

await Promise.all(
  liveWnbaEvents.map(async event => {
    try {
      const summaryUrl =
        `https://site.api.espn.com/apis/site/v2/sports/${espnSportPath}/summary?event=${event.id}`;

      const summaryResponse = await fetch(summaryUrl, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache'
        }
      });

      if (!summaryResponse.ok) return;

      const summaryData = await summaryResponse.json();

      const plays =
        Array.isArray(summaryData.plays)
          ? summaryData.plays
          : [];

      const latestPlay = plays[plays.length - 1];

      if (!latestPlay) return;

      wnbaLatestPlays[event.id] = {
        typeId: latestPlay.type?.id ?? null,
        typeText: latestPlay.type?.text ?? null,
        text: latestPlay.text ?? null,
        clock: latestPlay.clock?.displayValue ?? null,
        period: latestPlay.period?.number ?? null,
        teamId: latestPlay.team?.id ?? null
      };
    } catch (err) {
      // Keep normal ESPN scoreboard data if a summary lookup fails.
    }
  })
);


const liveFootballEvents =
  sport.startsWith('americanfootball')
    ? (data.events || []).filter(
        event => event.status?.type?.state === 'in'
      )
    : [];

await Promise.all(
  liveFootballEvents.map(async event => {
    try {
      const summaryUrl =
        `https://site.api.espn.com/apis/site/v2/sports/${espnSportPath}/summary?event=${event.id}`;

      const summaryResponse = await fetch(summaryUrl, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache'
        }
      });

      if (!summaryResponse.ok) return;

      const summaryData = await summaryResponse.json();

      const previousDrives =
        Array.isArray(summaryData.drives?.previous)
          ? summaryData.drives.previous
          : [];

      const currentDrives =
        Array.isArray(summaryData.drives?.current)
          ? summaryData.drives.current
          : summaryData.drives?.current
          ? [summaryData.drives.current]
          : [];

      const plays = [...previousDrives, ...currentDrives].flatMap(
        drive => Array.isArray(drive?.plays) ? drive.plays : []
      );

      const latestPlay = plays[plays.length - 1];

      if (!latestPlay) return;

      footballLatestPlays[event.id] = {
        typeId: latestPlay.type?.id ?? null,
        typeText: latestPlay.type?.text ?? null,
        text: latestPlay.text ?? null,
        clock: latestPlay.clock?.displayValue ?? null,
        period: latestPlay.period?.number ?? null
      };
    } catch (err) {
      // Keep normal ESPN scoreboard data if a summary lookup fails.
    }
  })
);


const games = (data.events || []).map(event => {
      const competition = event.competitions?.[0];
      const competitors = competition?.competitors || [];

      const home = competitors.find(c => c.homeAway === 'home');
      const away = competitors.find(c => c.homeAway === 'away');

      const status = event.status || {};
      const type = status.type || {};
      const situation = competition?.situation || {};

      return {
        id: event.id,
        name: event.name,
        shortName: event.shortName,
        date: event.date,
        statusName: type.name || null,
        statusState: type.state || null,
        statusDescription: type.description || null,
        statusDetail: type.detail || null,
		competitionTypeId: competition?.type?.id || null,
        competitionTypeAbbreviation: competition?.type?.abbreviation || null,
        period: status.period || null,
        clock: status.displayClock || null,
		
	wnbaLatestPlayTypeId:
      sport === 'basketball_wnba'
        ? wnbaLatestPlays[event.id]?.typeId ?? null
        : null,

    wnbaLatestPlayTypeText:
      sport === 'basketball_wnba'
        ? wnbaLatestPlays[event.id]?.typeText ?? null
        : null,

    wnbaLatestPlayText:
      sport === 'basketball_wnba'
        ? wnbaLatestPlays[event.id]?.text ?? null
        : null,

    wnbaLatestPlayClock:
      sport === 'basketball_wnba'
        ? wnbaLatestPlays[event.id]?.clock ?? null
        : null,

    wnbaLatestPlayPeriod:
      sport === 'basketball_wnba'
        ? wnbaLatestPlays[event.id]?.period ?? null
        : null,

    wnbaLatestPlayTeamId:
      sport === 'basketball_wnba'
        ? wnbaLatestPlays[event.id]?.teamId ?? null
        : null,
	
		
	footballLatestPlayTypeId:
      sport.startsWith('americanfootball')
        ? footballLatestPlays[event.id]?.typeId ?? null
        : null,

    footballLatestPlayTypeText:
      sport.startsWith('americanfootball')
        ? footballLatestPlays[event.id]?.typeText ?? null
        : null,

    footballLatestPlayText:
      sport.startsWith('americanfootball')
        ? footballLatestPlays[event.id]?.text ?? null
        : null,

    footballLatestPlayClock:
      sport.startsWith('americanfootball')
        ? footballLatestPlays[event.id]?.clock ?? null
        : null,

    footballLatestPlayPeriod:
      sport.startsWith('americanfootball')
        ? footballLatestPlays[event.id]?.period ?? null
        : null,	
		
        clockSeconds:
          sport === 'soccer_usa_mls'
            ? status.clock ?? null
            : null,

        mlsClockAnchorSeconds:
          sport === 'soccer_usa_mls'
            ? mlsClockAnchors[event.id]?.clockSeconds ?? null
            : null,

        mlsClockAnchorWallclock:
          sport === 'soccer_usa_mls'
            ? mlsClockAnchors[event.id]?.wallclock ?? null
            : null,
		
		balls:
          sport === 'baseball_mlb'
            ? situation.balls ?? null
            : null,

        strikes:
          sport === 'baseball_mlb'
            ? situation.strikes ?? null
            : null,

        outs:
          sport === 'baseball_mlb'
            ? situation.outs ?? null
            : null,
			
		        possessionText:
          sport.startsWith('americanfootball')
            ? situation.possessionText ?? null
            : null,

        possessionTeamId:
          sport.startsWith('americanfootball')
            ? situation.possession ?? null
            : null,

        down:
          sport.startsWith('americanfootball')
            ? situation.down ?? null
            : null,

        distance:
          sport.startsWith('americanfootball')
            ? situation.distance ?? null
            : null,

        downDistanceText:
          sport.startsWith('americanfootball')
            ? situation.downDistanceText ?? null
            : null,

        shortDownDistanceText:
          sport.startsWith('americanfootball')
            ? situation.shortDownDistanceText ?? null
            : null,

        homeTimeouts:
          sport.startsWith('americanfootball')
            ? situation.homeTimeouts ?? null
            : null,

        awayTimeouts:
          sport.startsWith('americanfootball')
            ? situation.awayTimeouts ?? null
            : null,	

        onFirst:
          sport === 'baseball_mlb'
            ? Boolean(situation.onFirst)
            : false,

        onSecond:
          sport === 'baseball_mlb'
            ? Boolean(situation.onSecond)
            : false,

        onThird:
          sport === 'baseball_mlb'
            ? Boolean(situation.onThird)
            : false,
		
        homeTeam: home?.team?.displayName || null,
        awayTeam: away?.team?.displayName || null,
        homeTeamId: home?.id ?? home?.team?.id ?? null,
        awayTeamId: away?.id ?? away?.team?.id ?? null,
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