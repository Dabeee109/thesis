/**
 * GeoError represents domain and mapping errors with HTTP status codes and error details.
 */
class GeoError extends Error {
  constructor(code, message, status = 422, details = null) {
    super(message);
    this.name = 'GeoError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

module.exports = { GeoError };
