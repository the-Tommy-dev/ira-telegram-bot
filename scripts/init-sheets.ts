import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { syncGoogleSheets } from "../src/lib/sheets";

syncGoogleSheets()
  .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
