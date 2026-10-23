const { Redis } = require('@upstash/redis');
const supabase = require('../lib/supabase');

const redis = Redis.fromEnv();
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

if (sport === 'americanfootball_ncaaf') {
  try {
    const fcsUrl = new URL(url);
    fcsUrl.searchParams.set('groups', '81');
    fcsUrl.searchParams.set('limit', '300');

    const fcsResponse = await fetch(fcsUrl.toString(), {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache'
      }
    });

    if (fcsResponse.ok) {
      const fcsData = await fcsResponse.json();

      const existingIds = new Set(
        (data.events || []).map(event => String(event.id))
      );

      for (const event of fcsData.events || []) {
        if (!existingIds.has(String(event.id))) {
          data.events = data.events || [];
          data.events.push(event);
          existingIds.add(String(event.id));
        }
      }
    }
  } catch (error) {
    console.error('ESPN FCS scoreboard request failed:', error);
  }
}

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

       const rawClockSeconds = Number(
  latestWithWallclock.play?.clock?.value ??
  latestWithWallclock.time?.value
);

const clockDisplay = String(
  latestWithWallclock.play?.clock?.displayValue ??
  latestWithWallclock.time?.displayValue ??
  ''
).trim();

const stoppageMatch = clockDisplay.match(
  /^(\d+)'?\+(\d+)'?$/
);

let anchorClockSeconds = rawClockSeconds;

if (stoppageMatch) {
  const baseMinutes = Number(stoppageMatch[1]);
  const addedMinutes = Number(stoppageMatch[2]);

  anchorClockSeconds =
    (baseMinutes + addedMinutes) * 60;
}

mlsClockAnchors[event.id] = {
  clockSeconds: anchorClockSeconds,
  wallclock: latestWithWallclock.play.wallclock,
  precision: stoppageMatch ? 'approximate' : 'precise'
};
      } catch (err) {
        // Keep normal ESPN scoreboard data if a summary lookup fails.
      }
    })
  );
}

const mlbLatestPlays = {};

const liveMlbEvents =
  sport === 'baseball_mlb'
    ? (data.events || []).filter(
        event => event.status?.type?.state === 'in'
      )
    : [];

await Promise.all(
  liveMlbEvents.map(async event => {
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

      const latestHomeRunPlay =
        [...plays]
          .reverse()
          .find(play =>
            String(play?.type?.id) === '28' ||
            (
              String(play?.type?.id) === '57' &&
              String(play?.text || '')
                .toLowerCase()
                .includes('homered')
            )
          ) || null;

      if (!latestPlay) return;

      const latestHomeRunBatterId =
        latestHomeRunPlay?.participants?.find(
          participant => participant?.type === 'batter'
        )?.athlete?.id ?? null;

      const latestHomeRunWallclock =
        latestHomeRunPlay?.wallclock ?? null;

      const pitcherId =
        latestPlay.participants?.find(
          participant => participant?.type === 'pitcher'
        )?.athlete?.id ?? null;

      const batterId =
        latestPlay.participants?.find(
          participant => participant?.type === 'batter'
        )?.athlete?.id ?? null;

      const boxscoreAthletes =
        (summaryData.boxscore?.players || [])
          .flatMap(team => team.statistics || [])
          .flatMap(group => group.athletes || []);

      const rosterAthletes =
        (summaryData.rosters || [])
          .flatMap(team => team.roster || []);

      const pitcher =
        boxscoreAthletes.find(
          player => String(player?.athlete?.id) === String(pitcherId)
        )?.athlete ?? null;

      const batter =
        rosterAthletes.find(
          player => String(player?.athlete?.id) === String(batterId)
        )?.athlete ??
        boxscoreAthletes.find(
          player => String(player?.athlete?.id) === String(batterId)
        )?.athlete ??
        null;

      mlbLatestPlays[event.id] = {
        typeId: latestPlay.type?.id ?? null,
        typeText: latestPlay.type?.text ?? null,
        text: latestPlay.text ?? null,
        period: latestPlay.period?.number ?? null,
        wallclock: latestPlay.wallclock ?? null,

        latestHomeRunWallclock,
        latestHomeRunBatterId,
        pitcherName:
          pitcher?.lastName ??
          pitcher?.shortName?.replace(/^[A-Z]\.\s*/, '') ??
          pitcher?.displayName ??
          null,
        batterId: batterId ?? null,
        batterName: batter?.lastName ?? batter?.displayName ?? null
      };
    } catch (err) {
      // Keep normal ESPN scoreboard data if a summary lookup fails.
    }
  })
);

const mlbSeriesData = {};

if (sport === 'baseball_mlb') {
  try {
    const mlbSeriesScheduleUrl =
      'https://statsapi.mlb.com/api/v1/schedule?sportId=1';

    const mlbSeriesScheduleResponse =
      await fetch(mlbSeriesScheduleUrl, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache'
        }
      });

    if (mlbSeriesScheduleResponse.ok) {
      const mlbSeriesScheduleData =
        await mlbSeriesScheduleResponse.json();

      const mlbSeriesScheduleGames =
        (mlbSeriesScheduleData.dates || [])
          .flatMap(date => date.games || []);

      for (const event of data.events || []) {
        const competition =
          event.competitions?.[0];

        const competitors =
          competition?.competitors || [];

        const home =
          competitors.find(
            competitor =>
              competitor.homeAway === 'home'
          );

        const away =
          competitors.find(
            competitor =>
              competitor.homeAway === 'away'
          );

        const espnHomeName =
          normalizeTeamName(
            home?.team?.displayName
          );

        const espnAwayName =
          normalizeTeamName(
            away?.team?.displayName
          );

        const espnStartMs =
          new Date(event.date).getTime();

        const mlbGame =
          mlbSeriesScheduleGames.find(game => {
            const mlbHomeName =
              normalizeTeamName(
                game?.teams?.home?.team?.name
              );

            const mlbAwayName =
              normalizeTeamName(
                game?.teams?.away?.team?.name
              );

            const mlbStartMs =
              new Date(game?.gameDate).getTime();

            return (
              mlbHomeName === espnHomeName &&
              mlbAwayName === espnAwayName &&
              Number.isFinite(espnStartMs) &&
              Number.isFinite(mlbStartMs) &&
              Math.abs(
                mlbStartMs - espnStartMs
              ) <= 60 * 60 * 1000
            );
          });

        if (!mlbGame) continue;

        mlbSeriesData[event.id] = {
          seriesDescription:
            mlbGame.seriesDescription ?? null,

          seriesGameNumber:
            mlbGame.seriesGameNumber ?? null,

          gamesInSeries:
            mlbGame.gamesInSeries ?? null,

          recordSource:
            mlbGame.recordSource ?? null,

          awayWins:
            mlbGame.teams?.away
              ?.leagueRecord?.wins ?? null,

          awayLosses:
            mlbGame.teams?.away
              ?.leagueRecord?.losses ?? null,

          homeWins:
            mlbGame.teams?.home
              ?.leagueRecord?.wins ?? null,

          homeLosses:
            mlbGame.teams?.home
              ?.leagueRecord?.losses ?? null
        };
      }
    }
  } catch (err) {
    // Keep normal ESPN data if MLB series lookup fails.
  }
}

const mlbLiveData = {};

if (sport === 'baseball_mlb' && liveMlbEvents.length > 0) {
  try {
    const mlbScheduleUrl =
      'https://statsapi.mlb.com/api/v1/schedule?sportId=1';

    const mlbScheduleResponse = await fetch(mlbScheduleUrl, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache'
      }
    });

    if (mlbScheduleResponse.ok) {
      const mlbScheduleData =
        await mlbScheduleResponse.json();

      const mlbScheduleGames =
        (mlbScheduleData.dates || [])
          .flatMap(date => date.games || []);

      await Promise.all(
        liveMlbEvents.map(async event => {
          try {
            const competition =
              event.competitions?.[0];

            const competitors =
              competition?.competitors || [];

            const home =
              competitors.find(
                competitor =>
                  competitor.homeAway === 'home'
              );

            const away =
              competitors.find(
                competitor =>
                  competitor.homeAway === 'away'
              );

            const espnHomeName =
              normalizeTeamName(
                home?.team?.displayName
              );

            const espnAwayName =
              normalizeTeamName(
                away?.team?.displayName
              );

            const espnStartMs =
              new Date(event.date).getTime();

            const mlbGame =
              mlbScheduleGames.find(game => {
                const mlbHomeName =
                  normalizeTeamName(
                    game?.teams?.home?.team?.name
                  );

                const mlbAwayName =
                  normalizeTeamName(
                    game?.teams?.away?.team?.name
                  );

                const mlbStartMs =
                  new Date(game?.gameDate).getTime();

                return (
                  mlbHomeName === espnHomeName &&
                  mlbAwayName === espnAwayName &&
                  Number.isFinite(espnStartMs) &&
                  Number.isFinite(mlbStartMs) &&
                  Math.abs(
                    mlbStartMs - espnStartMs
                  ) <= 60 * 60 * 1000
                );
              });

            if (!mlbGame?.gamePk) return;

            const mlbFeedUrl =
              `https://statsapi.mlb.com/api/v1.1/game/${mlbGame.gamePk}/feed/live`;

            const mlbFeedResponse =
              await fetch(mlbFeedUrl, {
                cache: 'no-store',
                headers: {
                  'Cache-Control': 'no-cache'
                }
              });

            if (!mlbFeedResponse.ok) return;

            const mlbFeedData =
              await mlbFeedResponse.json();

            const currentPlay =
              mlbFeedData.liveData?.plays
                ?.currentPlay;

            const linescore =
              mlbFeedData.liveData?.linescore;

            if (!currentPlay || !linescore) return;

            mlbLiveData[event.id] = {
              gamePk: mlbGame.gamePk,

              inning:
                linescore.currentInning ?? null,

              halfInning:
                currentPlay.about?.halfInning ?? null,

              inningState:
                linescore.inningState ?? null,

              balls:
                currentPlay.count?.balls ?? null,

              strikes:
                currentPlay.count?.strikes ?? null,

              outs:
                currentPlay.count?.outs ?? null,

              awayScore:
                linescore.teams?.away?.runs ?? null,

              homeScore:
                linescore.teams?.home?.runs ?? null,

              batterId:
                currentPlay.matchup?.batter?.id ??
                null,

              batterName:
                currentPlay.matchup?.batter
                  ?.fullName ?? null,

              pitcherId:
                currentPlay.matchup?.pitcher?.id ??
                null,

              pitcherName:
                currentPlay.matchup?.pitcher
                  ?.fullName ?? null,

              pitcherPitchCount: (() => {
                const pitcherId =
                  currentPlay.matchup?.pitcher?.id;

                if (!pitcherId) return null;

                const boxscoreTeams =
                  mlbFeedData.liveData?.boxscore?.teams;

                for (const side of ['away', 'home']) {
                  const pitchingStats =
                    boxscoreTeams?.[side]?.players?.[
                      `ID${pitcherId}`
                    ]?.stats?.pitching;

                  if (
                    Number.isFinite(
                      pitchingStats?.numberOfPitches
                    )
                  ) {
                    return pitchingStats.numberOfPitches;
                  }
                }

                return null;
              })()
            };
          } catch (err) {
            // Keep normal ESPN MLB data if
            // an MLB live-feed lookup fails.
          }
        })
      );
    }
  } catch (err) {
    // Keep normal ESPN MLB data if MLB
    // schedule discovery fails.
  }
}

const wnbaLatestPlays = {};

const liveWnbaEvents =
  (sport === 'basketball_wnba' || sport === 'basketball_nba')
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

      const recentNotificationPlays = plays
        .filter(play => {
          const typeId = String(play.type?.id ?? '');
          const typeText = String(play.type?.text ?? '').toLowerCase();

          return (
            typeId === '16' ||
            (typeText.includes('foul') && typeText !== 'no foul')
          );
        })
        .slice(-20);

      const summaryCompetitors =
        summaryData.header?.competitions?.[0]?.competitors || [];

      const summaryHome =
        summaryCompetitors.find(
          competitor => competitor.homeAway === 'home'
        );

      const summaryAway =
        summaryCompetitors.find(
          competitor => competitor.homeAway === 'away'
        );

      if (!latestPlay) return;

      wnbaLatestPlays[event.id] = {
        recentNotificationPlays: recentNotificationPlays.map(play => ({
          id: play.id ?? null,
          typeId: play.type?.id ?? null,
          typeText: play.type?.text ?? null,
          teamId: play.team?.id ?? null,
          period: play.period?.number ?? null,
          clock: play.clock?.displayValue ?? null,
          wallclock: play.wallclock ?? null
        })),
        playId: latestPlay.id ?? null,
        typeId: latestPlay.type?.id ?? null,
        typeText: latestPlay.type?.text ?? null,
        text: latestPlay.text ?? null,
        clock: latestPlay.clock?.displayValue ?? null,
        period: latestPlay.period?.number ?? null,
        wallclock: latestPlay.wallclock ?? null,
        teamId: latestPlay.team?.id ?? null,
        awayFoulsToGive:
          summaryAway?.fouls?.foulsToGive ?? null,
        awayBonusState:
          summaryAway?.fouls?.bonusState ?? null,
        homeFoulsToGive:
          summaryHome?.fouls?.foulsToGive ?? null,
        homeBonusState:
          summaryHome?.fouls?.bonusState ?? null
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

const latestScoringPlay = [...plays].reverse().find(play => {
  const typeText = String(play.type?.text || '').toLowerCase();

  return (
    play.scoringPlay === true &&
    (
      typeText.includes('touchdown') ||
      typeText === 'field goal good'
    )
  );
});

      const latestTeamTimeout = [...plays].reverse().find(play => {
        if (String(play.type?.id ?? '') !== '21') {
          return false;
        }

        const timeoutTeams = (play.teamParticipants || []).filter(
          participant => participant.timeout === true && participant.id
        );

        return timeoutTeams.length === 1;
      });

      const latestPlay = plays[plays.length - 1];

      if (!latestPlay) return;

      footballLatestPlays[event.id] = {
        typeId: latestPlay.type?.id ?? null,
        typeText: latestPlay.type?.text ?? null,
        text: latestPlay.text ?? null,
        clock: latestPlay.clock?.displayValue ?? null,
        period: latestPlay.period?.number ?? null,
        wallclock: latestPlay.wallclock ?? null,

        teamTimeout: latestTeamTimeout
          ? {
              id: latestTeamTimeout.id ?? null,
              teamId: String(
                latestTeamTimeout.teamParticipants.find(
                  participant => participant.timeout === true
                ).id
              ),
              clock: latestTeamTimeout.clock?.displayValue ?? null,
              period: latestTeamTimeout.period?.number ?? null,
              wallclock: latestTeamTimeout.wallclock ?? null
            }
          : null,

        scoringPlay: latestScoringPlay
          ? {
              id: latestScoringPlay.id ?? null,
              typeId: latestScoringPlay.type?.id ?? null,
              typeText: latestScoringPlay.type?.text ?? null,
              text: latestScoringPlay.text ?? null,
              clock: latestScoringPlay.clock?.displayValue ?? null,
              period: latestScoringPlay.period?.number ?? null,
              wallclock: latestScoringPlay.wallclock ?? null
            }
          : null
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
        seasonType: event.season?.type ?? null,
        seasonSlug: event.season?.slug || null,
        period: status.period || null,
        clock: status.displayClock || null,

        mlbLatestPlayTypeId:
          sport === 'baseball_mlb'
            ? mlbLatestPlays[event.id]?.typeId ?? null
            : null,

        mlbLatestPlayTypeText:
          sport === 'baseball_mlb'
            ? mlbLatestPlays[event.id]?.typeText ?? null
            : null,

        mlbLatestPlayText:
          sport === 'baseball_mlb'
            ? mlbLatestPlays[event.id]?.text ?? null
            : null,

        mlbLatestPlayPeriod:
          sport === 'baseball_mlb'
            ? mlbLatestPlays[event.id]?.period ?? null
            : null,

        mlbLatestPlayWallclock:
          sport === 'baseball_mlb'
            ? mlbLatestPlays[event.id]?.wallclock ?? null
            : null,

        mlbLatestHomeRunWallclock:
          sport === 'baseball_mlb'
            ? mlbLatestPlays[event.id]?.latestHomeRunWallclock ?? null
            : null,

        mlbLatestHomeRunBatterId:
          sport === 'baseball_mlb'
            ? mlbLatestPlays[event.id]?.latestHomeRunBatterId ?? null
            : null,

        mlbHalfInning:
          sport === 'baseball_mlb'
            ? mlbLiveData[event.id]?.halfInning ?? null
            : null,

        mlbPitcherId:
          sport === 'baseball_mlb'
            ? mlbLiveData[event.id]?.pitcherId ?? null
            : null,

        mlbPitcherName:
          sport === 'baseball_mlb'
            ? mlbLiveData[event.id]?.pitcherName ??
              mlbLatestPlays[event.id]?.pitcherName ??
              null
            : null,

        mlbPitcherPitchCount:
          sport === 'baseball_mlb'
            ? mlbLiveData[event.id]?.pitcherPitchCount ?? null
            : null,

        mlbBatterId:
          sport === 'baseball_mlb'
            ? mlbLiveData[event.id]?.batterId ??
              mlbLatestPlays[event.id]?.batterId ??
              null
            : null,

        mlbBatterName:
          sport === 'baseball_mlb'
            ? mlbLiveData[event.id]?.batterName ??
              mlbLatestPlays[event.id]?.batterName ??
              null
            : null,

        mlbSeriesDescription:
          sport === 'baseball_mlb'
            ? mlbSeriesData[event.id]?.seriesDescription ?? null
            : null,

        mlbSeriesGameNumber:
          sport === 'baseball_mlb'
            ? mlbSeriesData[event.id]?.seriesGameNumber ?? null
            : null,

        mlbGamesInSeries:
          sport === 'baseball_mlb'
            ? mlbSeriesData[event.id]?.gamesInSeries ?? null
            : null,

        mlbSeriesRecordSource:
          sport === 'baseball_mlb'
            ? mlbSeriesData[event.id]?.recordSource ?? null
            : null,

        mlbSeriesAwayWins:
          sport === 'baseball_mlb'
            ? mlbSeriesData[event.id]?.awayWins ?? null
            : null,

        mlbSeriesAwayLosses:
          sport === 'baseball_mlb'
            ? mlbSeriesData[event.id]?.awayLosses ?? null
            : null,

        mlbSeriesHomeWins:
          sport === 'baseball_mlb'
            ? mlbSeriesData[event.id]?.homeWins ?? null
            : null,

        mlbSeriesHomeLosses:
          sport === 'baseball_mlb'
            ? mlbSeriesData[event.id]?.homeLosses ?? null
            : null,

    basketballRecentNotificationPlays:
      (sport === 'basketball_wnba' || sport === 'basketball_nba')
        ? wnbaLatestPlays[event.id]?.recentNotificationPlays ?? []
        : [],


    wnbaLatestPlayId:
      (sport === 'basketball_wnba' || sport === 'basketball_nba')
        ? wnbaLatestPlays[event.id]?.playId ?? null
        : null,

    wnbaLatestPlayTypeId:
      (sport === 'basketball_wnba' || sport === 'basketball_nba')
        ? wnbaLatestPlays[event.id]?.typeId ?? null
        : null,

    wnbaLatestPlayTypeText:
      (sport === 'basketball_wnba' || sport === 'basketball_nba')
        ? wnbaLatestPlays[event.id]?.typeText ?? null
        : null,

    wnbaLatestPlayText:
      (sport === 'basketball_wnba' || sport === 'basketball_nba')
        ? wnbaLatestPlays[event.id]?.text ?? null
        : null,

    wnbaLatestPlayClock:
      (sport === 'basketball_wnba' || sport === 'basketball_nba')
        ? wnbaLatestPlays[event.id]?.clock ?? null
        : null,

    wnbaLatestPlayPeriod:
      (sport === 'basketball_wnba' || sport === 'basketball_nba')
        ? wnbaLatestPlays[event.id]?.period ?? null
        : null,

    wnbaLatestPlayTeamId:
      (sport === 'basketball_wnba' || sport === 'basketball_nba')
        ? wnbaLatestPlays[event.id]?.teamId ?? null
        : null,

    wnbaAwayFoulsToGive:
      (sport === 'basketball_wnba' || sport === 'basketball_nba')
        ? wnbaLatestPlays[event.id]?.awayFoulsToGive ?? null
        : null,

    wnbaAwayBonusState:
      (sport === 'basketball_wnba' || sport === 'basketball_nba')
        ? wnbaLatestPlays[event.id]?.awayBonusState ?? null
        : null,

    wnbaHomeFoulsToGive:
      (sport === 'basketball_wnba' || sport === 'basketball_nba')
        ? wnbaLatestPlays[event.id]?.homeFoulsToGive ?? null
        : null,

    wnbaHomeBonusState:
      (sport === 'basketball_wnba' || sport === 'basketball_nba')
        ? wnbaLatestPlays[event.id]?.homeBonusState ?? null
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

    footballLatestPlayWallclock:
      sport.startsWith('americanfootball')
        ? footballLatestPlays[event.id]?.wallclock ?? null
        : null,

	footballLatestScoringPlay:
      sport.startsWith('americanfootball')
        ? footballLatestPlays[event.id]?.scoringPlay ?? null
        : null,

        footballLatestTeamTimeout:
      sport.startsWith('americanfootball')
        ? footballLatestPlays[event.id]?.teamTimeout ?? null
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

        mlsClockAnchorPrecision:
          sport === 'soccer_usa_mls'
            ? mlsClockAnchors[event.id]?.precision ?? null
            : null,
		
		balls:
          sport === 'baseball_mlb'
            ? mlbLiveData[event.id]?.balls ??
              situation.balls ??
              null
            : null,

        strikes:
          sport === 'baseball_mlb'
            ? mlbLiveData[event.id]?.strikes ??
              situation.strikes ??
              null
            : null,

        outs:
          sport === 'baseball_mlb'
            ? mlbLiveData[event.id]?.outs ??
              situation.outs ??
              null
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

        wnbaSeriesInfo:
          sport === 'basketball_wnba' &&
          competition?.series?.type === 'playoff' &&
          competition?.notes?.some(note =>
            /WNBA Finals/i.test(note.headline || '')
          )
            ? {
                description: 'WNBA Finals',

                gameNumber:
                  Number(
                    competition.notes
                      .find(note =>
                        /WNBA Finals/i.test(note.headline || '')
                      )
                      ?.headline?.match(/Game\s+(\d+)/i)?.[1]
                  ) || null,

                totalGames:
                  competition.series.totalCompetitions ?? null,

                homeWins:
                  competition.series.competitors?.find(
                    team =>
                      String(team.id) ===
                      String(home?.id ?? home?.team?.id)
                  )?.wins ?? null,

                awayWins:
                  competition.series.competitors?.find(
                    team =>
                      String(team.id) ===
                      String(away?.id ?? away?.team?.id)
                  )?.wins ?? null
              }
            : null,

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

        gameKey: event.id
          ? `espn_${event.id}`
          : `${normalizeTeamName(away?.team?.displayName)}_${normalizeTeamName(home?.team?.displayName)}_${String(event.date || '').slice(0, 10)}`
      };
    });

    // Attach server-recorded completion times to FINAL games.
    const finalGames = games.filter(game =>
      game.statusState === 'post' ||
      game.statusName === 'STATUS_FINAL'
    );

    if (finalGames.length > 0) {
      try {
        const observations = await Promise.all(
          finalGames.map(game =>
            redis.get(`game_observation:${game.gameKey}`)
          )
        );

        finalGames.forEach((game, index) => {
          game.completedObservedAt =
            observations[index]?.completed_observed_at || null;
        });

        // Fall back to Supabase when Redis has no completion timestamp.
        const missingTimestamps = finalGames.filter(
          game => !game.completedObservedAt
        );

        if (missingTimestamps.length > 0) {
          const { data, error } = await supabase
            .from('completed_games')
            .select('game_key, completed_observed_at, completed_at')
            .in(
              'game_key',
              missingTimestamps.map(game => game.gameKey)
            );

          if (error) {
            console.error('Completion timestamp lookup:', error.message);
          } else {
            const completionTimes = new Map(
              (data || []).map(record => [
                record.game_key,
                record.completed_observed_at || record.completed_at
              ])
            );

            missingTimestamps.forEach(game => {
              game.completedObservedAt =
                completionTimes.get(game.gameKey) || null;
            });
          }
        }

      } catch (err) {
        // Keep ESPN scores available if Redis is unavailable.
      }
    }

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