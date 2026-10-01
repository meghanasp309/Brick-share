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

/**
 * A rupee amount like 105 or 105.50, returned in paise (1 rupee = 100 paise)
 * so we never do maths with rounding errors. Throws a 400 if it's not valid.
 */
function rupees(body, field, { max }) {
  const value = Number(body[field]);
  const paise = Math.round(value * 100);
  if (!Number.isFinite(value) || value <= 0 || Math.abs(value * 100 - paise) > 1e-6) {
    throw new HttpError(400, `${field} must be a positive amount in rupees, with at most 2 decimals`);
  }
  if (paise > max) throw new HttpError(400, `${field} can be at most ₹${(max / 100).toLocaleString("en-IN")}`);
  return paise;
}

// The shape of each Indian ID number. The website has the same rules (frontend/src/lib/idFormats.js).
const ID_FORMATS = {
  aadhaar: { pattern: /^[2-9][0-9]{11}$/, message: "Aadhaar must be 12 digits and can't start with 0 or 1 (like 2345 6789 0123)" },
  pan: { pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/, message: "PAN must be 5 letters, 4 digits, then 1 letter (like ABCDE1234F)" },
  passport: { pattern: /^[A-Z][0-9]{7}$/, message: "Passport must be 1 letter then 7 digits (like A1234567)" },
};

/** Returns the ID number cleaned up (no spaces, uppercase), or throws a 400 if it has the wrong shape. */
function idNumber(body, field, idType) {
  const value = text(body, field, { max: 20 }).replace(/\s/g, "").toUpperCase();
  if (!ID_FORMATS[idType].pattern.test(value)) throw new HttpError(400, ID_FORMATS[idType].message);
  return value;
}

module.exports = { text, positive, oneOf, rupees, idNumber };
