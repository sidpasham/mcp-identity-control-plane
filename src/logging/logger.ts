import pino from "pino";
import { config } from "../config/config.js";

export const logger = pino({
  name: config.serviceName,
  level: config.logLevel
});
