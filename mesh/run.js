import { createService } from './shared/service.js';
import { getServiceConfig } from './config.js';

const serviceName = process.env.SERVICE_NAME;
const config = getServiceConfig(serviceName);

if (!config) {
  throw new Error(`Unknown SERVICE_NAME "${serviceName}" — check mesh/config.js for valid names`);
}

const app = createService(config, { logger: true });
const port = Number(process.env.PORT ?? 3000);

app.listen({ host: '0.0.0.0', port }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
