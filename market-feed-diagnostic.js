async function runMarketFeedDiagnostic() {
  try {
    const sport =
      document.getElementById('sport-select')?.value ||
      'baseball_mlb';

    console.log(
      `SCO BETS AI — MARKET FEED DIAGNOSTIC | ${sport}`
    );

    const snapshotResponse = await fetch(
      `/api/odds-snapshot?sport=${encodeURIComponent(sport)}`,
      {
        cache: 'no-store'
      }
    );

    if (!snapshotResponse.ok) {
      throw new Error(
        `Snapshot request failed (${snapshotResponse.status})`
      );
    }

    const snapshot =
      await snapshotResponse.json();

    const capturedAt =
      new Date().toISOString();

    const snapshotFetchedAt =
      snapshotResponse.headers.get(
        'X-Snapshot-Fetched-At'
      ) ||
      snapshot.snapshotGeneratedAt ||
      null;

    const now = Date.now();

    const rawGames =
      Array.isArray(snapshot?.debug?.rawOddsGames)
        ? snapshot.debug.rawOddsGames
        : [];

    const games =
      Array.isArray(snapshot?.games)
        ? snapshot.games
        : [];

    const rawGameKeys = new Set(
      rawGames.map(game =>
        [
          String(game.away || '').toLowerCase(),
          String(game.home || '').toLowerCase(),
          String(game.commence_time || '')
        ].join('|')
      )
    );

    const detailedGames =
      games.map(game => {
        const gameKey =
          [
            String(game.away || '').toLowerCase(),
            String(game.home || '').toLowerCase(),
            String(game.commence_time || '')
          ].join('|');

        const bookmakers =
          Array.isArray(game.bookmakers)
            ? game.bookmakers.map(book => {
                const lastUpdate =
                  book.lastUpdate || null;

                const updateTime =
                  lastUpdate
                    ? new Date(lastUpdate).getTime()
                    : NaN;

                const ageMinutes =
                  Number.isFinite(updateTime)
                    ? Math.max(
                        0,
                        Math.round(
                          (now - updateTime) /
                          60000
                        )
                      )
                    : null;

                return {
                  book: book.title || '',
                  lastUpdate,
                  ageMinutes,

                  odds:
                    Array.isArray(book.odds)
                      ? book.odds.map(outcome => ({
                          name:
                            outcome.name || '',
                          price:
                            outcome.price ?? null
                        }))
                      : []
                };
              })
            : [];

        return {
          matchup:
            `${game.away || ''} vs ${game.home || ''}`,

          commenceTime:
            game.commence_time || null,

          status:
            game.status || null,

          retainedMarket:
            game.retainedMarket === true,

          presentInRawOddsApiResponse:
            rawGameKeys.has(gameKey),

          espnState:
            game.espnStatus?.statusState ||
            null,

          espnName:
            game.espnStatus?.statusName ||
            null,

          espnDescription:
            game.espnStatus?.statusDescription ||
            null,

          espnDetail:
            game.espnStatus?.statusDetail ||
            null,

          bookmakers
        };
      });

    const retainedGames =
      detailedGames.filter(
        game =>
          game.retainedMarket === true ||
          game.presentInRawOddsApiResponse === false
      );

    const staleBooks =
      detailedGames.flatMap(game =>
        game.bookmakers
          .filter(
            book =>
              Number.isFinite(book.ageMinutes) &&
              book.ageMinutes >= 20
          )
          .map(book => ({
            matchup: game.matchup,
            status: game.status,
            retainedMarket:
              game.retainedMarket,
            presentInRawOddsApiResponse:
              game.presentInRawOddsApiResponse,
            book: book.book,
            ageMinutes:
              book.ageMinutes,
            lastUpdate:
              book.lastUpdate
          }))
      );

    const diagnostic = {
      capturedAt,
      sport,
      snapshotFetchedAt,

      rawOddsGameCount:
        snapshot?.debug?.rawOddsGameCount ??
        rawGames.length,

      dashboardGameCount:
        games.length,

      retainedGameCount:
        retainedGames.length,

      staleBookCount:
        staleBooks.length,

      rawOddsGames:
        rawGames,

      retainedGames,

      staleBooks,

      games:
        detailedGames
    };

    window.scoMarketFeedDiagnostic =
      diagnostic;

    console.log(
      'CAPTURED AT:',
      capturedAt
    );

    console.log(
      'SNAPSHOT FETCHED AT:',
      snapshotFetchedAt
    );

    console.log(
      'RAW ODDS API GAMES:',
      diagnostic.rawOddsGameCount
    );

    console.log(
      'DASHBOARD GAMES:',
      diagnostic.dashboardGameCount
    );

    console.log(
      'RETAINED / MISSING FROM RAW:',
      diagnostic.retainedGameCount
    );

    console.log(
      'BOOKMAKERS 20+ MINUTES OLD:',
      diagnostic.staleBookCount
    );

    if (retainedGames.length) {
      console.table(
        retainedGames.map(game => ({
          matchup:
            game.matchup,
          status:
            game.status,
          retainedMarket:
            game.retainedMarket,
          inRawOddsApiResponse:
            game.presentInRawOddsApiResponse
        }))
      );
    }

    if (staleBooks.length) {
      console.table(staleBooks);
    }

    console.log(
      'FULL DIAGNOSTIC:',
      diagnostic
    );

    console.log(
      'Saved as window.scoMarketFeedDiagnostic'
    );

    return diagnostic;
  } catch (error) {
    console.error(
      'SCO MARKET FEED DIAGNOSTIC FAILED:',
      error
    );

    return null;
  }
}

window.runMarketFeedDiagnostic =
  runMarketFeedDiagnostic;