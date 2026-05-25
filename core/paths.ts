import path from 'node:path';
import os from 'node:os';

export const DATA_DIR =
  process.env.FUNGIBLE_DATA_DIR ?? path.join(os.homedir(), '.fungible');
