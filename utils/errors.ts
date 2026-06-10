export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, status: number = 400, code: string = "ERROR", details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = "Authentication failed", details?: Record<string, unknown>) {
    super(message, 401, "AUTH_FAILED", details);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = "Forbidden", details?: Record<string, unknown>) {
    super(message, 403, "FORBIDDEN", details);
    this.name = "AuthorizationError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 400, "VALIDATION_ERROR", details);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = "Not found", details?: Record<string, unknown>) {
    super(message, 404, "NOT_FOUND", details);
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = "Rate limit exceeded", details?: Record<string, unknown>) {
    super(message, 429, "RATE_LIMITED", details);
    this.name = "RateLimitError";
  }
}

export class InsufficientBalanceError extends AppError {
  constructor(message: string = "Insufficient balance", details?: Record<string, unknown>) {
    super(message, 402, "INSUFFICIENT_BALANCE", details);
    this.name = "InsufficientBalanceError";
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function toErrorResponse(error: AppError): Response {
  return new Response(JSON.stringify({
    status: "ERROR",
    reason: error.message,
    code: error.code,
    ...(error.details || {}),
  }), {
    status: error.status,
    headers: { "Content-Type": "application/json" },
  });
}
