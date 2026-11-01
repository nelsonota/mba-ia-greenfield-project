export abstract class DomainException extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class EmailAlreadyExistsException extends DomainException {
  constructor() {
    super('EMAIL_ALREADY_EXISTS', 409, 'Email is already registered');
  }
}

export class InvalidCredentialsException extends DomainException {
  constructor() {
    super('INVALID_CREDENTIALS', 401, 'Invalid email or password');
  }
}

export class EmailNotConfirmedException extends DomainException {
  constructor() {
    super('EMAIL_NOT_CONFIRMED', 403, 'Email address has not been confirmed');
  }
}

export class InvalidTokenException extends DomainException {
  constructor() {
    super('INVALID_TOKEN', 401, 'Token is invalid');
  }
}

export class TokenExpiredException extends DomainException {
  constructor() {
    super('TOKEN_EXPIRED', 401, 'Token has expired');
  }
}

export class TokenReuseDetectedException extends DomainException {
  constructor() {
    super(
      'TOKEN_REUSE_DETECTED',
      401,
      'Token reuse detected — all sessions revoked',
    );
  }
}

export class InvalidUploadRequestException extends DomainException {
  constructor() {
    super(
      'INVALID_UPLOAD_REQUEST',
      400,
      'Upload metadata or idempotency key is invalid',
    );
  }
}

export class IdempotencyConflictException extends DomainException {
  constructor() {
    super(
      'IDEMPOTENCY_CONFLICT',
      409,
      'Idempotency key was already used with different upload metadata',
    );
  }
}

export class VideoTooLargeException extends DomainException {
  constructor() {
    super('VIDEO_TOO_LARGE', 413, 'Video exceeds the 10 GB upload limit');
  }
}

export class StorageUnavailableException extends DomainException {
  constructor() {
    super(
      'STORAGE_UNAVAILABLE',
      503,
      'Video storage is temporarily unavailable',
    );
  }
}

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video was not found');
  }
}

export class VideoNotOwnedException extends DomainException {
  constructor() {
    super('VIDEO_NOT_OWNED', 403, 'Video is owned by another user');
  }
}

export class InvalidUploadPartsException extends DomainException {
  constructor() {
    super('INVALID_UPLOAD_PARTS', 400, 'Multipart parts are invalid');
  }
}

export class UploadNotActiveException extends DomainException {
  constructor() {
    super('UPLOAD_NOT_ACTIVE', 409, 'Multipart upload is not active');
  }
}

export class ProcessingQueueUnavailableException extends DomainException {
  constructor() {
    super(
      'PROCESSING_QUEUE_UNAVAILABLE',
      503,
      'Video processing queue is temporarily unavailable',
    );
  }
}

export class RangeNotSatisfiableException extends DomainException {
  readonly contentRange: string;

  constructor(resourceSize: number) {
    super(
      'RANGE_NOT_SATISFIABLE',
      416,
      'Requested byte range cannot be served',
    );
    this.contentRange = `bytes */${resourceSize}`;
  }
}
