// Builds the Express app (the list of URLs the server answers).
const express = require("express");
const db = require("./db");
const chain = require("./chain");
const { errorHandler } = require("./errors");
const authRoutes = require("./routes/auth");
const { kyc, admin } = require("./routes/kyc");
const propertyRoutes = require("./routes/properties");
const { router: orderRoutes } = require("./routes/orders");
const portfolioRoutes = require("./routes/portfolio");

function createApp() {
  const app = express();
  app.use(express.json());

  // Lets the frontend (another port on your laptop) call this API.
  app.use((req, res, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // Quick check that the server, database and blockchain are all up.
  app.get("/health", async (_req, res) => {
    await db.query("SELECT 1");
    res.json({ ok: true, database: "ok", blockchain: await chain.networkInfo() });
  });

  app.use(authRoutes);
  app.use(kyc);
  app.use("/admin", admin);
  app.use(propertyRoutes);
  app.use(orderRoutes);
  app.use(portfolioRoutes);

  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
