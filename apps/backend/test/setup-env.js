require("reflect-metadata");

process.env.DATABASE_URL ??=
  "postgres://ruehrai:ruehrai@127.0.0.1:5432/ruehrai";
process.env.JWT_SECRET ??= "test-jwt-secret-not-for-production";
process.env.PORT ??= "3000";
