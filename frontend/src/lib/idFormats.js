// The shape of each Indian ID number. The server checks the same rules (backend/src/validate.js).
export const ID_FORMATS = {
  aadhaar: {
    pattern: /^[2-9][0-9]{11}$/,
    maxLength: 14, // 12 digits plus 2 spaces
    placeholder: "2345 6789 0123",
    hint: "12 digits, can't start with 0 or 1. Example: 2345 6789 0123",
    message: "Aadhaar must be 12 digits and can't start with 0 or 1.",
  },
  pan: {
    pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
    maxLength: 10,
    placeholder: "ABCDE1234F",
    hint: "5 letters, 4 digits, 1 letter. Example: ABCDE1234F",
    message: "PAN must be 5 letters, then 4 digits, then 1 letter.",
  },
  passport: {
    pattern: /^[A-Z][0-9]{7}$/,
    maxLength: 8,
    placeholder: "A1234567",
    hint: "1 letter, then 7 digits. Example: A1234567",
    message: "Passport must be 1 letter, then 7 digits.",
  },
};

/** Removes spaces and makes letters uppercase, the way the server stores it. */
export const cleanIdNumber = (value) => value.replace(/\s/g, "").toUpperCase();

/** Returns an error message for a bad ID number, or null if it looks right. */
export function idNumberError(idType, value) {
  const format = ID_FORMATS[idType];
  return format.pattern.test(cleanIdNumber(value)) ? null : format.message;
}
