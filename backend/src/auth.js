// Login tokens (JWT) and role checks.
const jwt = require("jsonwebtoken");
const config = require("./config");
const db = require("./db");
const { HttpError } = require("./errors");

const ROLES = ["investor", "owner", "admin", "land_authority"];

const signToken = (user) => jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: "7d" });

/** Requires "Authorization: Bearer <token>". Puts the user on req.user. */
async function requireAuth(req, _res, next) {
  const [scheme, token] = (req.headers.authorization || "").split(" ");
  if (scheme !== "Bearer" || !token) throw new HttpError(401, "Please log in first");
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw new HttpError(401, "Your login has expired. Please log in again");
  }
  const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [payload.sub]);
  if (!rows[0]) throw new HttpError(401, "User no longer exists");
  req.user = rows[0];
  next();
}

/** Only lets in users with one of these roles. Use after requireAuth. */
const requireRole = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.role)) throw new HttpError(403, `Only ${roles.join(" or ")} users can do this`);
  next();
};

/** Only lets in users whose KYC was approved. Use after requireAuth. */
const requireKyc = (req, _res, next) => {
  if (req.user.kyc_status !== "approved") throw new HttpError(403, "Your KYC must be approved first");
  next();
};

/** The user fields that are safe to send to the app (no password, no key). */
const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  fullName: u.full_name,
  role: u.role,
  walletAddress: u.wallet_address,
  kycStatus: u.kyc_status,
  createdAt: u.created_at,
});

module.exports = { ROLES, signToken, requireAuth, requireRole, requireKyc, publicUser };
