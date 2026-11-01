import { RangeNotSatisfiableException } from '../common/exceptions/domain.exception';

export interface ByteRange {
  start: number;
  end: number;
}

export function parseByteRange(
  rangeHeader: string | undefined,
  resourceSize: number,
): ByteRange | undefined {
  if (rangeHeader === undefined) return undefined;
  if (!Number.isSafeInteger(resourceSize) || resourceSize <= 0) {
    throw new RangeNotSatisfiableException(
      Number.isSafeInteger(resourceSize) ? Math.max(0, resourceSize) : 0,
    );
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match || (!match[1] && !match[2])) {
    throw new RangeNotSatisfiableException(resourceSize);
  }

  const [, first, last] = match;
  if (!first) {
    const suffixLength = Number(last);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw new RangeNotSatisfiableException(resourceSize);
    }
    return {
      start: Math.max(0, resourceSize - suffixLength),
      end: resourceSize - 1,
    };
  }

  const start = Number(first);
  const end = last ? Number(last) : resourceSize - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= resourceSize
  ) {
    throw new RangeNotSatisfiableException(resourceSize);
  }

  return { start, end: Math.min(end, resourceSize - 1) };
}
