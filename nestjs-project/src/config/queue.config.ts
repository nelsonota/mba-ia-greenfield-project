import { registerAs } from '@nestjs/config';

export default registerAs('queue', () => ({
  redis: {
    host: process.env.REDIS_HOST ?? 'redis',
    port: Number(process.env.REDIS_PORT ?? 6379),
    username: process.env.REDIS_USERNAME ?? 'default',
    password: process.env.REDIS_PASSWORD ?? 'streamtube-redis-local',
    db: Number(process.env.REDIS_DB ?? 0),
  },
}));
