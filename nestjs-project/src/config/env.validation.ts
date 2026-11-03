import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  REDIS_HOST: Joi.string().default('redis'),
  REDIS_PORT: Joi.number().port().default(6379),
  VIDEO_WORKER_CONCURRENCY: Joi.number().integer().min(1).max(32).default(2),
  JWT_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),
  CONFIRMATION_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  PASSWORD_RESET_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  APP_URL: Joi.string().uri().default('http://localhost:3000'),
  MAIL_HOST: Joi.string().default('mailpit'),
  MAIL_PORT: Joi.number().default(1025),
  MAIL_FROM: Joi.string().default('"StreamTube" <noreply@streamtube.com>'),
  SWAGGER_ENABLED: Joi.string().valid('true', 'false').default('false'),
  S3_ENDPOINT: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default('http://minio:9000')
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
    }),
  S3_PUBLIC_ENDPOINT: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default('http://localhost:9002')
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
    }),
  S3_REGION: Joi.string().default('us-east-1').when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
  }),
  S3_BUCKET: Joi.string().default('streamtube-videos').when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
  }),
  S3_ACCESS_KEY: Joi.string().default('streamtube').when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
  }),
  S3_SECRET_KEY: Joi.string()
    .min(8)
    .default('streamtube-secret')
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
    }),
  S3_SIGNED_URL_EXPIRES_IN: Joi.number()
    .integer()
    .min(1)
    .max(604800)
    .default(900),
});
