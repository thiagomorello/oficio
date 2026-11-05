// CLI administrativa: node dist/server/cli.js <comando> (ou `npm run cli -- <comando>`).
import { parseArgs } from './cli-args';
import { main } from './cli-commands';

const code = await main(process.argv.slice(2), process.env, parseArgs, (l) => process.stdout.write(l + '\n'));
process.exit(code);
