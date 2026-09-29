require("reflect-metadata");

process.env.DATABASE_URL ??=
  "postgres://ruehrai:ruehrai@127.0.0.1:5432/ruehrai";
process.env.JWT_SECRET ??= "test-jwt-secret-not-for-production";
process.env.PORT ??= "3000";
// Keep e2e on the PLZ-catalog fallback. A developer .env must not point tests at Data-Scout.
process.env.DATASCOUT_DATABASE_URL = "";
