export default async function handler(req, res) {
  try {
    const apiKey = process.env.ODDS_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "Missing API Key" });
    }

    const requestedSport = req.query.sport || 'basketball_ncaab';

    const allowedSports = ['basketball_ncaab', 'basketball_nba'];
    const sport = allowedSports.includes(requestedSport)
      ? requestedSport
      : 'basketball_ncaab';

    const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds?regions=us&markets=h2h&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm&apiKey=${apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: "Odds API request failed",
        details: text
      });
    }

    const data = await response.json();

    const simplified = data.slice(0, 8).map(game => {
      return {
        home: game.home_team,
        away: game.away_team,
        bookmakers: (game.bookmakers || []).map(bookmaker => {
          const market = bookmaker.markets?.find(m => m.key === "h2h");
          return {
            title: bookmaker.title,
            odds: market?.outcomes || []
          };
        }).filter(b => b.odds.length >= 2)
      };
    });

    res.status(200).json({
      sport,
      games: simplified
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to load odds",
      details: err.message
    });
  }
}