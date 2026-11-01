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
  S3_ENDPOINT: Joi.string().uri().default('http://rustfs:9000'),
  S3_REGION: Joi.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: Joi.string().min(1).default('streamtube'),
  S3_SECRET_ACCESS_KEY: Joi.string().min(8).default('streamtube-local-secret'),
  S3_BUCKET: Joi.string().min(1).default('streamtube-videos'),
  S3_FORCE_PATH_STYLE: Joi.string().valid('true', 'false').default('true'),
  S3_CREATE_BUCKET_IF_MISSING: Joi.string()
    .valid('true', 'false')
    .default('true'),
  REDIS_HOST: Joi.string().min(1).default('redis'),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_USERNAME: Joi.string().min(1).default('default'),
  REDIS_PASSWORD: Joi.string().min(1).default('streamtube-redis-local'),
  REDIS_DB: Joi.number().integer().min(0).default(0),
});
