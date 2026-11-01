import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import { DomainException } from '../exceptions/domain.exception';

@Catch(DomainException)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const contentRange = (
      exception as DomainException & { contentRange?: string }
    ).contentRange;
    if (contentRange) response.setHeader('Content-Range', contentRange);

    response.status(exception.httpStatus).json({
      statusCode: exception.httpStatus,
      error: exception.errorCode,
      message: exception.message,
    });
  }
}
