const { HttpError } = require("./errors");

/** Returns a trimmed text field, or throws a 400 if it's missing or too long. */
function text(body, field, { max = 200, optional = false } = {}) {
  const value = typeof body[field] === "string" ? body[field].trim() : "";
  if (!value && !optional) throw new HttpError(400, `${field} is required`);
  if (value.length > max) throw new HttpError(400, `${field} is too long (max ${max} characters)`);
  return value;
}

/** Returns a positive number, or throws a 400. */
function positive(body, field, { integer = false, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(body[field]);
  if (!Number.isFinite(value) || value <= 0 || value > max || (integer && !Number.isInteger(value))) {
    throw new HttpError(400, `${field} must be a positive ${integer ? "whole number" : "number"}`);
  }
  return value;
}

function oneOf(body, field, options) {
  const value = body[field];
  if (!options.includes(value)) throw new HttpError(400, `${field} must be one of: ${options.join(", ")}`);
  return value;
}

module.exports = { text, positive, oneOf };
