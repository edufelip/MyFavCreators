import { apiConfig } from "@creator-outdoor/config/api";
import { createApp } from "./app";
import { database } from "./database";

const app = createApp({
  database,
  product: apiConfig.product,
  allowedOrigins: apiConfig.corsAllowedOrigins,
  adminApiSecret: apiConfig.adminApiSecret,
});

app.listen(apiConfig.port);

console.info(`Creator Outdoor API listening on http://localhost:${apiConfig.port}`);
