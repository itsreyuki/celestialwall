const { initCanvasDatabase, getDatabasePool } = require('../db');

initCanvasDatabase()
  .then(() => {
    if (!getDatabasePool()) {
      console.log('DATABASE_URL is not configured; migrations were skipped.');
      return;
    }
    console.log('Migrations complete.');
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  });
