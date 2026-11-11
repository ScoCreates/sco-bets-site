const GAME_PK = '849833';
const POLL_MS = 1000;

let previousSignature = '';

function timestamp() {
  return new Date().toLocaleTimeString('en-US', {
    hour12: true,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

async function checkGame() {
  try {
    const url =
      `https://statsapi.mlb.com/api/v1.1/game/${GAME_PK}/feed/live?_=${Date.now()}`;

    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache'
      }
    });

    if (!response.ok) {
      console.log(
        `[${timestamp()}] HTTP ${response.status}`
      );
      return;
    }

    const data = await response.json();

    const play = data?.liveData?.plays?.currentPlay;
    const linescore = data?.liveData?.linescore;

    if (!play) return;

    const inning = play?.about?.inning ?? '?';
    const half = play?.about?.halfInning ?? '?';

    const balls = play?.count?.balls ?? '?';
    const strikes = play?.count?.strikes ?? '?';
    const outs = play?.count?.outs ?? '?';

    const batter =
      play?.matchup?.batter?.fullName || '?';

    const pitcher =
      play?.matchup?.pitcher?.fullName || '?';

    const awayScore =
      linescore?.teams?.away?.runs ?? '?';

    const homeScore =
      linescore?.teams?.home?.runs ?? '?';

    const description =
      play?.result?.description || '';

    const signature = JSON.stringify({
      inning,
      half,
      balls,
      strikes,
      outs,
      batter,
      pitcher,
      awayScore,
      homeScore,
      description
    });

    if (signature !== previousSignature) {
      previousSignature = signature;

      console.log('');
      console.log(
        `[${timestamp()}] ${half.toUpperCase()} ${inning}`
      );
      console.log(
        `Score: ${awayScore}-${homeScore} | Count: ${balls}-${strikes} | Outs: ${outs}`
      );
      console.log(
        `Batter: ${batter} | Pitcher: ${pitcher}`
      );

      if (description) {
        console.log(`Event: ${description}`);
      }
    }
  } catch (error) {
    console.log(
      `[${timestamp()}] ERROR: ${error.message}`
    );
  }
}

console.log(
  `Watching MLB game ${GAME_PK} every ${POLL_MS / 1000} second...`
);

await checkGame();

setInterval(checkGame, POLL_MS);