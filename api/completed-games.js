const supabase = require("../lib/supabase");

module.exports = async (req, res) => {
  try {
    const requestedSport = String(req.query.sport || "").trim();

    const requestedHours = Number(req.query.hours);

    const retentionHours =
      Number.isFinite(requestedHours) &&
      requestedHours > 0 &&
      requestedHours <= 120
        ? requestedHours
        : 24;

    const cutoff = new Date(
      Date.now() - retentionHours * 60 * 60 * 1000
    ).toISOString();

    let query = supabase
      .from("completed_games")
      .select("*")
      .gte("completed_at", cutoff)
      .order("completed_at", { ascending: false })
      .limit(100);

    if (requestedSport) {
      query = query.eq("sport", requestedSport);
    }

    const { data, error } = await query;

    if (error) {
      console.error("completed-games read error:", error.message);

      return res.status(500).json({
        error: "Failed to load completed games"
      });
    }

const gameKeys = (data || [])
  .map(game => game.game_key)
  .filter(Boolean);

let observations = [];

if (gameKeys.length > 0) {
  const {
    data: observationData,
    error: observationError
  } = await supabase
    .from("game_observations")
    .select("game_key, completed_observed_at")
    .in("game_key", gameKeys);

  if (observationError) {
    console.error(
      "game_observations read error:",
      observationError.message
    );
  } else {
    observations = observationData || [];
  }
}

const observationMap = Object.fromEntries(
  observations.map(observation => [
    observation.game_key,
    observation.completed_observed_at || null
  ])
);

    const completedGames = (data || []).map(game => ({
  id: `cached-${game.game_key}`,
  gameKey: game.game_key,

  sport: game.sport,
  away: game.away_team,
  home: game.home_team,

  status: "final",
  cachedFinal: true,

  cachedAt: game.cached_at,
  completedObservedAt:
    observationMap[game.game_key] || null,
  serverCompletedAt: game.completed_at,

  espnStatus: game.espn_status
}));

return res.status(200).json({
  sport: requestedSport || "all",
  completedGames
});
  } catch (err) {
    console.error("completed-games read error:", err);

    return res.status(500).json({
      error: "Failed to load completed games"
    });
  }
};