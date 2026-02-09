import { createApp } from './app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();

// DATA_ROOT берём из env, но если его нет — createApp сам возьмёт дефолт по LOCAL_DEV.md
const app = createApp({ dataRoot: env.DATA_ROOT });

app.listen(env.PORT, () => {
  console.log(`Admin service listening on port ${env.PORT}`);
  console.log(`DATA_ROOT: ${env.DATA_ROOT || '(default from LOCAL_DEV.md)'}`);
  console.log(`Assets URL example: http://localhost:${env.PORT}/assets/cars/<assets_folder>/<file>`);
});
