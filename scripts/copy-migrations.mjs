import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

const sourceDirectory = path.resolve('src/db/migrations');
const targetDirectory = path.resolve('dist/db/migrations');

await mkdir(path.dirname(targetDirectory), { recursive: true });
await cp(sourceDirectory, targetDirectory, { recursive: true });
