export class DatabaseError extends Error {
  code?: string;
  details?: string;

  constructor(error: { message: string; code?: string; details?: string }) {
    super(error.message);
    this.name = 'DatabaseError';
    this.code = error.code;
    this.details = error.details;
  }
}

export function databaseError(error: { message: string; code?: string; details?: string }): DatabaseError {
  return new DatabaseError(error);
}
