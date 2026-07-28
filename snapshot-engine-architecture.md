# SCO Bets AI — Snapshot Engine Architecture

## Purpose

The Snapshot Engine creates one shared, processed copy of the latest sportsbook and game-status data for each supported sport.

Instead of every bettor causing a separate request to The Odds API and ESPN, SCO Bets AI will fetch and process the data centrally. All dashboard users will then read the same stored snapshot.

The goals are:

- Reduce Odds API usage and operating cost.
- Improve dashboard response speed.
- Keep all bettors synchronized on the same data.
- Preserve the last successful snapshot during provider failures.
- Support additional sports, sportsbooks, and Bettor's Scoreboard data without redesigning the system.

---

## Current Architecture

```text
User browser
    ↓
/api/odds
    ↓
The Odds API
    +
ESPN
    ↓
Normalize and calculate
    ↓
Return finished payload to that user