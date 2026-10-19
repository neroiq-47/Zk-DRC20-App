import type { Problem } from '@zoko/contracts';

const TITLES: Record<number, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload too large',
  415: 'Unsupported media type',
  422: 'Unprocessable content',
  429: 'Too many requests',
  500: 'Internal server error',
  501: 'Not implemented',
  502: 'Bad gateway',
  503: 'Service unavailable',
};

/** An error that is rendered as application/problem+json. */
export class HttpProblem extends Error {
  readonly status: number;
  readonly code: string;
  readonly errors?: Record<string, string>;
  constructor(status: number, code: string, detail?: string, errors?: Record<string, string>) {
    super(detail ?? TITLES[status] ?? 'Error');
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
  toProblem(): Problem {
    return problemBody(this.status, this.code, this.message, this.errors);
  }
}

export function problemBody(status: number, code: string, detail?: string, errors?: Record<string, string>): Problem {
  const p: Problem = {
    type: `https://zoko.app/problems/${code.replace(/_/g, '-')}`,
    title: TITLES[status] ?? 'Error',
    status,
    code,
  };
  if (detail) p.detail = detail;
  if (errors && Object.keys(errors).length) p.errors = errors;
  return p;
}

export const notFound = (what = 'Resource') => new HttpProblem(404, 'not_found', `${what} not found.`);
export const forbidden = (detail = 'You do not have access to this resource.', code = 'forbidden') =>
  new HttpProblem(403, code, detail);
