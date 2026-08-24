import { apiConfig } from "@creator-outdoor/config/api";
import { createApp } from "./app";
import { database } from "./database";

const app = createApp({
  database,
  product: apiConfig.product,
  allowedOrigins: apiConfig.corsAllowedOrigins,
  adminApiSecret: apiConfig.adminApiSecret,
  fanIdentitySecret: apiConfig.fanIdentitySecret,
  // The PIX simulation surface never exists in a production process.
  enableDevPixSimulation: !apiConfig.isProduction,
  selfOrigin: `http://localhost:${apiConfig.port}`,
});

app.listen(apiConfig.port);

console.info(`Creator Outdoor API listening on http://localhost:${apiConfig.port}`);
