/** API entry point: `npm run dev` (watch) or `npm start` (built). */

import { openDatabase } from './db.js';
import { createServer } from './server.js';

const port = Number(process.env['PORT'] ?? 3000);

const db = await openDatabase();
createServer(db).listen(port, () => {
  console.log(`FantaTracker API in ascolto su http://localhost:${port}`);
});
