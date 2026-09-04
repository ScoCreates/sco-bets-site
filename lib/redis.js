import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export function getOddsSnapshotKey(sport) {
  return `odds_snapshot:${sport}`;
}

export default redis;