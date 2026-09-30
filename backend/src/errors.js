/** An error with an HTTP status code, e.g. new HttpError(404, "Not found"). */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Express error handler: turns any error into a JSON response. */
function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.name === "MulterError") return res.status(400).json({ error: err.message });
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Request body is not valid JSON" });
  // PostgreSQL: a value had the wrong type, e.g. /properties/abc
  if (err.code === "22P02") return res.status(400).json({ error: "Invalid id or value" });

  // The smart contract refused (e.g. PropertyFrozen, AlreadyApproved).
  const revert = err.revert || err.info?.error?.data?.revert;
  if (revert?.name) {
    return res.status(409).json({ error: `Blockchain refused: ${revert.name}`, args: revert.args?.map(String) });
  }
  // Can't reach the blockchain.
  if (err.code === "ECONNREFUSED" || err.code === "NETWORK_ERROR" || err.code === "TIMEOUT") {
    return res.status(503).json({ error: "Blockchain or database is not reachable. Is Docker running?" });
  }

  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server" });
}

module.exports = { HttpError, errorHandler };
