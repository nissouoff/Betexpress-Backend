// init-db-postgres.js
async function createTables(pool) {
  console.log("📂 Initialisation de la base de données...");

  try {
    // Table principale "users"
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        name TEXT,
        inscription_date TIMESTAMPTZ DEFAULT NOW(),
        promo_code TEXT
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS wallet_users (
        user_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        wallet_total NUMERIC DEFAULT 0,
        gain NUMERIC DEFAULT 0,
        perte NUMERIC DEFAULT 0,
        last_update TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT fk_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS promo_code (
        user_id TEXT PRIMARY KEY,
        promo_code TEXT NOT NULL,
        total_use NUMERIC DEFAULT 0,
        CONSTRAINT fk_user_promo FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS betDays (
        id TEXT PRIMARY KEY,
        titre_de_pari TEXT NOT NULL,
        team1 TEXT,
        url_team1 TEXT,
        team2 TEXT,
        url_team2 TEXT,
        heur TIMESTAMPTZ,
        pari TEXT,
        reponse1 TEXT,
        reponse2 TEXT,
        total_particip INTEGER DEFAULT 0,
        total_reponse1 INTEGER DEFAULT 0,
        total_reponse2 INTEGER DEFAULT 0
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS accept_pari (
        id_unique TEXT PRIMARY KEY,
        id_user TEXT,
        id_pari TEXT,
        mis_pari NUMERIC,
        reponse_pari TEXT,
        statu_pari TEXT,
        date_pari TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT fk_accept_user FOREIGN KEY(id_user) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_accept_bet FOREIGN KEY(id_pari) REFERENCES betDays(id) ON DELETE CASCADE
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS block_list (
        id SERIAL PRIMARY KEY,
        hash TEXT UNIQUE NOT NULL,
        user_id TEXT,
        date TIMESTAMPTZ DEFAULT NOW(),
        usdt NUMERIC,
        CONSTRAINT fk_block_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS deposits (
        hash TEXT PRIMARY KEY,
        user_id TEXT,
        usdt NUMERIC,
        status TEXT DEFAULT 'wait',
        date TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT fk_deposit_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifi (
        id UUID PRIMARY KEY,
        user_id TEXT NOT NULL,
        valide TEXT,
        date TIMESTAMPTZ DEFAULT NOW(),
        lecture TEXT DEFAULT 'no',
        CONSTRAINT fk_notifi_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    console.log("✅ Base de données initialisée avec succès !");
  } catch (err) {
    console.error("💥 Erreur lors de l'initialisation de la base :", err);
    throw err; // Pour que index.js puisse gérer l'erreur
  }
}

module.exports = createTables;