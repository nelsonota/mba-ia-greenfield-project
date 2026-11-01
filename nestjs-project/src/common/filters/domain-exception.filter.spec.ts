import { ArgumentsHost } from '@nestjs/common';
import { DomainExceptionFilter } from './domain-exception.filter';
import {
  EmailAlreadyExistsException,
  EmailNotConfirmedException,
  InvalidCredentialsException,
  InvalidTokenException,
  TokenExpiredException,
  TokenReuseDetectedException,
} from '../exceptions/domain.exception';

describe('DomainExceptionFilter', () => {
  let filter: DomainExceptionFilter;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    filter = new DomainExceptionFilter();
    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });

    mockHost = {
      switchToHttp: () => ({
        getResponse: () => ({ status: mockStatus }),
        getRequest: () => ({ url: '/test', method: 'POST' }),
      }),
      getArgs: () => [],
      getArgByIndex: () => null,
      switchToRpc: () => ({}) as never,
      switchToWs: () => ({}) as never,
      getType: () => 'http',
    } as unknown as ArgumentsHost;
  });

  function expectMappedError(statusCode: number, errorCode: string): void {
    expect(mockStatus).toHaveBeenCalledWith(statusCode);
    expect(mockJson).toHaveBeenCalledTimes(1);
    const calls = mockJson.mock.calls as unknown as [unknown][];
    const payload = calls[0]?.[0];
    expect(payload).toMatchObject({ statusCode, error: errorCode });
    const message =
      typeof payload === 'object' && payload !== null
        ? (payload as { message?: unknown }).message
        : undefined;
    expect(typeof message).toBe('string');
  }

  it('maps EmailAlreadyExistsException to 409 with EMAIL_ALREADY_EXISTS', () => {
    filter.catch(new EmailAlreadyExistsException(), mockHost);

    expect(mockStatus).toHaveBeenCalledWith(409);
    expect(mockJson).toHaveBeenCalledWith({
      statusCode: 409,
      error: 'EMAIL_ALREADY_EXISTS',
      message: 'Email is already registered',
    });
  });

  it('maps InvalidCredentialsException to 401 with INVALID_CREDENTIALS', () => {
    filter.catch(new InvalidCredentialsException(), mockHost);

    expectMappedError(401, 'INVALID_CREDENTIALS');
  });

  it('maps EmailNotConfirmedException to 403 with EMAIL_NOT_CONFIRMED', () => {
    filter.catch(new EmailNotConfirmedException(), mockHost);

    expectMappedError(403, 'EMAIL_NOT_CONFIRMED');
  });

  it('maps InvalidTokenException to 401 with INVALID_TOKEN', () => {
    filter.catch(new InvalidTokenException(), mockHost);

    expectMappedError(401, 'INVALID_TOKEN');
  });

  it('maps TokenExpiredException to 401 with TOKEN_EXPIRED', () => {
    filter.catch(new TokenExpiredException(), mockHost);

    expectMappedError(401, 'TOKEN_EXPIRED');
  });

  it('maps TokenReuseDetectedException to 401 with TOKEN_REUSE_DETECTED', () => {
    filter.catch(new TokenReuseDetectedException(), mockHost);

    expectMappedError(401, 'TOKEN_REUSE_DETECTED');
  });
});
