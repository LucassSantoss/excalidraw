/**
 * Rules of the notes domain being broken. Their messages reach API clients
 * as is; the presentation layer picks the HTTP status from the class.
 */

export class DomainError extends Error {}

/** the note, folder… doesn't exist */
export class NotFoundError extends DomainError {}

/** the input is malformed (missing field, wrong type or format) */
export class InvalidInputError extends DomainError {}

/** the input is well-formed but not allowed (e.g. renaming the daily folder) */
export class ForbiddenError extends DomainError {}

/** the data changed since the client last read it (e.g. in another window) */
export class ConflictError extends DomainError {}
