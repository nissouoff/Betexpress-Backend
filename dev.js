const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const DB_PATH = path.join(__dirname, "users.db");
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error("❌ Erreur lors de la connexion à la base de données :", err.message);
    return;
  }
  console.log("✅ Connexion à la base de données établie !");
});

db.serialize(() => {
  console.log("📂 Vérification/Création des tables...");

  // Table principale "users"
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      name TEXT,
      inscription_date TEXT,
      promo_code TEXT
    )
  `, (err) => {
    if (err) {
      console.error("❌ Erreur création table users :", err.message);
    } else {
      console.log("✅ Table 'users' prête !");
    }
  });

  // Table "wallet_users"
  db.run(`
    CREATE TABLE IF NOT EXISTS wallet_users (
      user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      wallet_total REAL DEFAULT 0,
      gain REAL DEFAULT 0,
      perte REAL DEFAULT 0,
      last_update TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) {
      console.error("❌ Erreur création table wallet_users :", err.message);
    } else {
      console.log("✅ Table 'wallet_users' prête !");
    }
  });

  // Table "promo_code"
  db.run(`
    CREATE TABLE IF NOT EXISTS promo_code (
      user_id TEXT PRIMARY KEY,
      promo_code TEXT NOT NULL,
      total_use REAL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) {
      console.error("❌ Erreur création table promo_code :", err.message);
    } else {
      console.log("✅ Table 'promo_code' prête !");
    }
  });

  // Table "betDays"
  db.run(`
    CREATE TABLE IF NOT EXISTS betDays (
      id TEXT PRIMARY KEY,
      titre_de_pari TEXT NOT NULL,
      team1 TEXT,
      url_team1 TEXT,
      team2 TEXT,
      url_team2 TEXT,
      heur TEXT,
      pari TEXT,
      reponse1 TEXT,
      reponse2 TEXT,
      total_particip REAL DEFAULT 0,
      total_reponse1 REAL DEFAULT 0,
      total_reponse2 REAL DEFAULT 0
    )
  `, (err) => {
    if (err) {
      console.error("❌ Erreur création table betDays :", err.message);
    } else {
      console.log("✅ Table 'betDays' prête !");
    }
  });

  // Table "accept_pari"
  db.run(`
    CREATE TABLE IF NOT EXISTS accept_pari (
      id_unique TEXT PRIMARY KEY,
      id_user TEXT,
      id_pari TEXT,
      mis_pari REAL,
      reponse_pari TEXT,
      statu_pari TEXT,
      date_pari TEXT,
      FOREIGN KEY (id_user) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (id_pari) REFERENCES betDays(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) {
      console.error("❌ Erreur création table accept_pari :", err.message);
    } else {
      console.log("✅ Table 'accept_pari' prête !");
    }
  });

  // Table "blok_list" (renommée pour cohérence, évite "block" qui peut être un mot réservé)
  db.run(`
    CREATE TABLE IF NOT EXISTS block_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT UNIQUE,
      user_id TEXT,
      date TEXT,
      usdt REAL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) {
      console.error("❌ Erreur création table block_list :", err.message);
    } else {
      console.log("✅ Table 'block_list' prête !");
    }
  });

  // Table "deposits"
  db.run(`
    CREATE TABLE IF NOT EXISTS deposits (
      hash TEXT PRIMARY KEY,
      id TEXT,
      usdt REAL,
      status TEXT DEFAULT 'wait',
      date TEXT,
      FOREIGN KEY (id) REFERENCES users(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) {
      console.error("❌ Erreur création table deposits :", err.message);
    } else {
      console.log("✅ Table 'deposits' prête !");
    }
  });

  // Table "notifi" (corrigée : suppression du tiret dans user_id et ajout de NOT NULL)
  db.run(`
    CREATE TABLE IF NOT EXISTS notifi (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      valide TEXT,
      date TEXT,
      lectur TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) {
      console.error("❌ Erreur création table notifi :", err.message);
    } else {
      console.log("✅ Table 'notifi' prête !");
    }
  });

  // Fermeture de la connexion après toutes les opérations
  db.close((err) => {
    if (err) {
      console.error("❌ Erreur lors de la fermeture de la base de données :", err.message);
    } else {
      console.log("✅ Connexion à la base de données fermée.");
    }
  });
});