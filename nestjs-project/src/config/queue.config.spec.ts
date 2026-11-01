import queueConfig from './queue.config';
import { envValidationSchema } from './env.validation';

const requiredEnvironment = {
  DB_USERNAME: 'streamtube',
  DB_PASSWORD: 'streamtube',
  DB_NAME: 'streamtube',
  JWT_SECRET: 'test-jwt-secret',
  JWT_REFRESH_SECRET: 'test-refresh-secret',
};

describe('QueueConfig', () => {
  const redisEnvironmentKeys = [
    'REDIS_HOST',
    'REDIS_PORT',
    'REDIS_USERNAME',
    'REDIS_PASSWORD',
    'REDIS_DB',
  ] as const;
  const originalRedisEnvironment = Object.fromEntries(
    redisEnvironmentKeys.map((key) => [key, process.env[key]]),
  );

  afterEach(() => {
    for (const key of redisEnvironmentKeys) {
      const originalValue = originalRedisEnvironment[key];
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
  });

  it('defaults to the Redis Compose service and validates its connection settings', () => {
    const result = envValidationSchema.validate(requiredEnvironment);

    expect(result.error).toBeUndefined();
    expect(result.value).toMatchObject({
      REDIS_HOST: 'redis',
      REDIS_PORT: 6379,
      REDIS_USERNAME: 'default',
      REDIS_DB: 0,
    });
  });

  it('rejects invalid Redis ports and database indexes', () => {
    const { error } = envValidationSchema.validate(
      {
        ...requiredEnvironment,
        REDIS_PORT: '70000',
        REDIS_DB: '-1',
      },
      { abortEarly: false },
    );

    expect(error?.details.map(({ path }) => path[0])).toEqual(
      expect.arrayContaining(['REDIS_PORT', 'REDIS_DB']),
    );
  });

  it('maps Redis environment values into the namespaced configuration', () => {
    process.env.REDIS_HOST = 'redis';
    process.env.REDIS_PORT = '6380';
    process.env.REDIS_USERNAME = 'default';
    process.env.REDIS_PASSWORD = 'test-redis-password';
    process.env.REDIS_DB = '2';

    expect(queueConfig().redis).toEqual({
      host: 'redis',
      port: 6380,
      username: 'default',
      password: 'test-redis-password',
      db: 2,
    });
  });
});
