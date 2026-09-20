import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export function getOddsSnapshotKey(sport) {
  return `odds_snapshot:${sport}`;
}

export function getCurrentEspnStatusKey(sport) {
  return `current_espn_status:${sport}`;
}

export function getOddsSnapshotScheduleKey() {
  return 'odds_snapshot_schedule';
}

export default redis;