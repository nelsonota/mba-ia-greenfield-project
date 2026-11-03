import { DomainException } from '../../common/exceptions/domain.exception';

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video was not found');
  }
}

export class VideoAccessDeniedException extends DomainException {
  constructor() {
    super('VIDEO_ACCESS_DENIED', 403, 'You do not own this video upload');
  }
}

export class InvalidPartNumbersException extends DomainException {
  constructor() {
    super(
      'INVALID_PART_NUMBERS',
      400,
      'One or more part numbers are out of range',
    );
  }
}

export class UploadNotInProgressException extends DomainException {
  constructor() {
    super(
      'UPLOAD_NOT_IN_PROGRESS',
      409,
      'The video upload is no longer in progress',
    );
  }
}

export class InvalidUploadPartsException extends DomainException {
  constructor() {
    super(
      'INVALID_UPLOAD_PARTS',
      400,
      'One or more uploaded parts could not be reconciled',
    );
  }
}

export class VideoNotReadyException extends DomainException {
  constructor() {
    super('VIDEO_NOT_READY', 409, 'The requested video output is not ready');
  }
}
