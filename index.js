const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();
const { ethers } = require("ethers");
const axios = require('axios');
const crypto = require('crypto');
const { Web3 } = require('web3');
const { Pool } = require('pg'); // 🔥 PostgreSQL

const app = express();
const PORT = process.env.PORT || 3001;

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors({ origin: "*", methods: ["GET", "POST"], allowedHeaders: ["Content-Type"] }));
app.use(express.json());

app.get("/", (req, res) => {
  res.send("API BetExpress en ligne ✅");
});

// === SOCKET.IO ===
io.on("connection", (socket) => {
  console.log("🟢 Un utilisateur est connecté :", socket.id);
  socket.on("disconnect", () => { // ✅ Ajout de () avant =>
    console.log("🔴 Utilisateur déconnecté :", socket.id);
  });
});

// === CONNEXION POSTGRESQL ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // nécessaire pour Render/Heroku, car cert auto-signé
  }
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) console.error("❌ Erreur connexion PostgreSQL :", err);
  else console.log("✅ Connecté à PostgreSQL");
});

async function initializeDatabase() {
  try {
    // Import dynamique du script d'init
    const { default: createTables } = await import('./init-db-postgres.js');
    // On crée un "pool temporaire" pour l'init, ou on passe le pool existant
    // Ici, on modifie `init-db-postgres.js` pour qu'il accepte un pool
    await createTables(pool);
  } catch (err) {
    console.error("💥 Échec de l'initialisation de la base de données :", err);
    // Optionnel : arrêter l'appli si la DB est critique
    // process.exit(1);
  }
}

// === CONFIG ===
const BINANCE_API_KEY = 'jf7pRrp3j7FaN7B2r95heXwBD42hOtMYTabfFV23efUlLqKN39IghJhsk2I8kF0b';
const BINANCE_API_SECRET = 'x7zvo58LkAjt8SJxJ3kIdEMZXQT0p4gwlMQynnRw8Nkc10umiiYFNtMaLsa3xwon';
const POLYGON_RPC_URL = 'https://polygon-mainnet.infura.io/v3/VIQDKTTZNTG6EXB341ZS28Q3Y1XHEXE11PT';
const DEPOSIT_ADDRESS = '0xe3578e7cbfc81ed8e7ae572764f8373cd8182de5'.toLowerCase();
const USDT_CONTRACT = '0xc2132d05d31c914a87c6611c10748aeb04b58e8f'.toLowerCase();
const TRANSFER_METHOD_ID = '0xa9059cbb';
const POLYGONSCAN_V2_API_KEY = 'IQDKTTZNTG6EXB341ZS28Q3Y1XHEXE11PT';

const web3 = new Web3(POLYGON_RPC_URL);

function signBinanceQuery(queryString) {
  return crypto.createHmac('sha256', BINANCE_API_SECRET).update(queryString).digest('hex');
}

// === Sauvegarder utilisateur ===
function saveUser(user, callback) {
  const dateNow = new Date();

  pool.query("SELECT * FROM users WHERE id = $1", [user.id], (err, result) => {
    if (err) return callback({ success: false, message: "Erreur DB ❌", error: err });

    const row = result.rows[0];

    const proceedWallet = () => {
      pool.query("SELECT * FROM wallet_users WHERE user_id = $1", [user.id], (err2, walletResult) => {
        if (err2) return console.error("❌ Erreur DB wallet_users :", err2.message);

        if (walletResult.rows.length === 0) {
          const sqlWallet = `
            INSERT INTO wallet_users (user_id, username, wallet_total, gain, perte, last_update)
            VALUES ($1, $2, 0, 0, 0, $3)
          `;
          pool.query(sqlWallet, [user.id, user.username || "", dateNow], (err3) => {
            if (err3) console.error("❌ Erreur insertion wallet_users :", err3.message);
            else console.log(`✅ Wallet créé pour : ${user.username || user.name}`);
          });
        }
      });
    };

    if (row) {
      proceedWallet();
      return callback({ success: true, message: "Utilisateur déjà inscrit ✅", user: row });
    } else {
      const sql = `
        INSERT INTO users (id, username, name, inscription_date, promo_code)
        VALUES ($1, $2, $3, $4, $5)
      `;
      pool.query(sql, [user.id, user.username || "", user.name || "", dateNow, ""], (err, insertResult) => {
        if (err) return callback({ success: false, message: "Erreur insertion ❌", error: err });
        proceedWallet();
        callback({
          success: true,
          message: "Nouvel utilisateur ajouté ✅",
          user: {
            id: user.id,
            username: user.username,
            name: user.name,
            inscription_date: dateNow,
            promo_code: ""
          }
        });
      });
    }
  });
}

// === ROUTES ===

app.post("/api/telegram-login", (req, res) => {
  const user = req.body;
  if (!user || !user.id) return res.status(400).json({ success: false, message: "User ID manquant ❌" });
  saveUser(user, (result) => res.json(result));
});

app.get("/api/users", (req, res) => {
  pool.query("SELECT * FROM users", (err, result) => {
    if (err) return res.status(500).json({ success: false, message: "Erreur DB ❌" });
    res.json({ success: true, users: result.rows });
  });
});

app.get("/api/bets", (req, res) => {
  pool.query("SELECT * FROM betDays", (err, result) => {
    if (err) {
      console.error("❌ Erreur récupération bets :", err.message);
      return res.json({ success: true, bets: [] });
    }

    const bets = result.rows.map(row => ({
      id: row.id,
      titre_de_pari: row.titre_de_pari || `${row.team1} vs ${row.team2}`,
      heur: row.heur,
      team1: row.team1,
      team2: row.team2,
      url_team1: row.url_team1,
      url_team2: row.url_team2,
      pari: row.pari,
      reponse1: row.reponse1,
      reponse2: row.reponse2,
      total_particip: row.total_particip || 0,
      total_reponse1: row.total_reponse1 || 0,
      total_reponse2: row.total_reponse2 || 0,
    }));

    res.json({ success: true, bets });
  });
});

app.post("/api/place-bet", (req, res) => {
  const { userId, betId, reponse } = req.body;
  const mise = 1;
  const dateNow = new Date();

  if (!userId || !betId || !reponse)
    return res.status(400).json({ success: false, message: "Paramètres manquants ❌" });

  pool.query("SELECT wallet_total FROM wallet_users WHERE user_id = $1", [userId], (err, walletResult) => {
    if (err) return res.status(500).json({ success: false, message: "Erreur serveur DB ❌" });
    const wallet = walletResult.rows[0];
    if (!wallet) return res.status(404).json({ success: false, message: "Utilisateur introuvable ❌" });
    if (parseFloat(wallet.wallet_total) < mise) return res.json({ success: false, message: "Solde insuffisant ❌" });

    const newSolde = parseFloat(wallet.wallet_total) - mise;

    pool.query(
      "UPDATE wallet_users SET wallet_total = $1, last_update = $2 WHERE user_id = $3",
      [newSolde, dateNow, userId],
      (err2) => {
        if (err2) return res.status(500).json({ success: false, message: "Erreur serveur update ❌" });

        const id_unique = `${userId}_${betId}_${Date.now()}`;
        const sqlInsert = `
          INSERT INTO accept_pari (id_unique, id_user, id_pari, mis_pari, reponse_pari, statu_pari, date_pari)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;

        pool.query(sqlInsert, [id_unique, userId, betId, mise, reponse, "Accepter", dateNow], (err3) => {
          if (err3) return res.status(500).json({ success: false, message: "Erreur serveur insertion ❌" });

          pool.query("SELECT * FROM betDays WHERE id = $1", [betId], (errBet, betResult) => {
            if (errBet) return console.error("❌ Erreur récupération betDays :", errBet.message);
            const bet = betResult.rows[0];
            if (!bet) return;

            let colUpdate;
            if (reponse === bet.reponse1) colUpdate = "total_reponse1";
            else if (reponse === bet.reponse2) colUpdate = "total_reponse2";
            else return console.error("⚠️ Réponse invalide :", reponse);

            const sqlUpdate = `
              UPDATE betDays 
              SET total_particip = total_particip + 1, ${colUpdate} = ${colUpdate} + 1 
              WHERE id = $1
            `;
            pool.query(sqlUpdate, [betId], (err4) => {
              if (err4) console.error("❌ Erreur update betDays :", err4.message);

              pool.query("SELECT * FROM betDays WHERE id = $1", [betId], (err5, updatedResult) => {
                if (err5) console.error("❌ Erreur récupération betDays :", err5.message);
                else if (updatedResult.rows[0]) io.emit("betUpdated", updatedResult.rows[0]);
              });
            });
          });

          io.emit("balanceUpdated", { userId, newBalance: newSolde });
          res.json({ success: true, message: `Mise de ${mise}$ placée sur "${reponse}" ✅`, newSolde });
        });
      }
    );
  });
});

app.get("/api/wallet/:id", (req, res) => {
  const userId = req.params.id;
  pool.query("SELECT * FROM wallet_users WHERE user_id = $1", [userId], (err, result) => {
    if (err) return res.status(500).json({ success: false, message: "Erreur serveur DB ❌" });
    const row = result.rows[0];
    if (!row) return res.status(404).json({ success: false, message: "Utilisateur introuvable ❌" });
    res.json({
      success: true,
      wallet: {
        user_id: row.user_id,
        wallet_total: parseFloat(row.wallet_total),
        gain: parseFloat(row.gain),
        perte: parseFloat(row.perte),
        last_update: row.last_update
      }
    });
  });
});

app.get("/api/accepted-bets/:userId", (req, res) => {
  const userId = req.params.userId;

  pool.query("SELECT * FROM accept_pari WHERE id_user = $1", [userId], (err, acceptedResult) => {
    if (err) return res.status(500).json({ success: false, message: "Erreur DB accept_pari ❌", err });

    const acceptedBets = acceptedResult.rows;
    if (acceptedBets.length === 0) return res.json({ success: true, acceptedBets: [], betDays: [] });

    const betIds = acceptedBets.map(b => b.id_pari);
    const placeholders = betIds.map((_, i) => `$${i + 1}`).join(",");
    const sqlBetDays = `SELECT * FROM betDays WHERE id IN (${placeholders})`;

    pool.query(sqlBetDays, betIds, (err2, betDaysResult) => {
      if (err2) return res.status(500).json({ success: false, message: "Erreur DB betDays ❌", err: err2 });
      res.json({ success: true, acceptedBets, betDays: betDaysResult.rows });
    });
  });
});

app.get("/api/get-user-info", (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ success: false, message: "ID requis" });

  const sql = `SELECT id, username, name, inscription_date, promo_code FROM users WHERE id = $1`;
  pool.query(sql, [id], (err, result) => {
    if (err) {
      console.error("❌ Erreur DB:", err.message);
      return res.status(500).json({ success: false, message: "Erreur serveur" });
    }
    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ success: false, message: "Utilisateur non trouvé" });
    }
    res.json(row);
  });
});

app.post("/api/update-user", (req, res) => {
  const { id, field, value } = req.body;
  if (!id || !field || value === undefined) {
    return res.status(400).json({ success: false, message: "Champs manquants" });
  }

  const allowedFields = ["name", "promo_code"];
  if (!allowedFields.includes(field)) {
    return res.status(400).json({ success: false, message: "Champ non autorisé" });
  }

  const sql = `UPDATE users SET ${field} = $1 WHERE id = $2`;
  pool.query(sql, [value, id], (err, result) => {
    if (err) {
      console.error("❌ Erreur DB:", err.message);
      return res.status(500).json({ success: false, message: "Erreur DB" });
    }

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Utilisateur non trouvé" });
    }

    res.json({ success: true, message: `${field} mis à jour`, field, value });
  });
});

app.get("/api/get-wallet", (req, res) => {
  const userId = req.query.id;
  if (!userId) return res.status(400).json({ error: "ID requis" });

  pool.query(
    `SELECT user_id, wallet_total, gain, perte, last_update FROM wallet_users WHERE user_id = $1`,
    [userId],
    (err, result) => {
      if (err) {
        console.error("❌ Erreur DB get-wallet:", err.message);
        return res.status(500).json({ error: "Erreur serveur DB" });
      }

      const row = result.rows[0];
      if (!row) {
        pool.query(
          `INSERT INTO wallet_users (user_id, username, wallet_total, gain, perte, last_update)
           VALUES ($1, $2, 0, 0, 0, NOW())`,
          [userId, "unknown"],
          (insertErr) => {
            if (insertErr) {
              console.error("❌ Erreur création wallet:", insertErr.message);
              return res.status(500).json({ error: "Impossible de créer le wallet" });
            }
            return res.json({
              user_id: userId,
              wallet_total: 0,
              gain: 0,
              perte: 0,
              last_update: new Date(),
            });
          }
        );
      } else {
        res.json(row);
      }
    }
  );
});

// === Dépôt USDT ===
app.post('/verify-deposit', async (req, res) => {
  console.log('📥 Requête reçue:', req.body);
  const { txId, amount, asset, userId } = req.body;

  if (!txId || asset !== 'USDT' || !userId) {
    return res.status(400).json({ success: false, message: 'Données invalides (txId, userId requis, asset doit être USDT)' });
  }

  try {
    const txUrl = `https://api.etherscan.io/v2/api?module=proxy&action=eth_getTransactionByHash&txhash=${txId}&chainid=137&apikey=${POLYGONSCAN_V2_API_KEY}`;
    const txResponse = await axios.get(txUrl);
    const txData = txResponse.data.result;

    if (!txData || txData.error) {
      return res.status(404).json({ success: false, message: 'Transaction non trouvée' });
    }

    const input = txData.input?.toLowerCase();
    const toLower = txData.to?.toLowerCase();

    if (toLower !== USDT_CONTRACT || !input?.startsWith(TRANSFER_METHOD_ID)) {
      return res.status(400).json({ success: false, message: 'Pas un dépôt USDT valide' });
    }

    const txAmountHex = '0x' + input.slice(74, 138);
    const txAmount = parseInt(txAmountHex, 16) / 1e6;

    const recipientHex = input.slice(34, 74);
    const recipient = '0x' + recipientHex.slice(-40);
    if (recipient.toLowerCase() !== DEPOSIT_ADDRESS) {
      return res.status(400).json({ success: false, message: 'Adresse destinataire incorrecte' });
    }

    const receiptUrl = `https://api.etherscan.io/v2/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txId}&chainid=137&apikey=${POLYGONSCAN_V2_API_KEY}`;
    const receiptResponse = await axios.get(receiptUrl);
    const receipt = receiptResponse.data.result;

    if (!receipt || receipt.status !== '0x1') {
      return res.status(400).json({ success: false, message: 'Transaction non confirmée' });
    }

    const tolerance = 0.01;
    if (Math.abs(txAmount - amount) > tolerance) {
      console.log(`❌ Montant incorrect. Attendu ~${amount}, reçu ${txAmount}`);
      return res.status(400).json({ 
        success: false, 
        message: `Montant invalide (attendu ${amount} USDT, reçu ${txAmount} USDT)` 
      });
    }

    // Vérif anti-double dépôt
    pool.query(`SELECT hash FROM blok_list WHERE hash = $1`, [txId], (err, hashResult) => {
      if (err) {
        console.error("❌ Erreur DB blok-list:", err);
        return res.status(500).json({ success: false, message: "Erreur DB vérification hash" });
      }

      if (hashResult.rows.length > 0) {
        return res.status(400).json({ success: false, message: "Hash déjà utilisé !" });
      }

      pool.query(`SELECT wallet_total FROM wallet_users WHERE user_id = $1`, [userId], (err2, walletResult) => {
        if (err2) {
          console.error("❌ Erreur DB wallet:", err2);
          return res.status(500).json({ success: false, message: "Erreur DB lecture wallet" });
        }

        const currentSolde = walletResult.rows[0] ? parseFloat(walletResult.rows[0].wallet_total) : 0;
        const newSolde = currentSolde + amount;

        pool.query(`UPDATE wallet_users SET wallet_total = $1 WHERE user_id = $2`, [newSolde, userId], (err3) => {
          if (err3) {
            console.error("❌ Erreur UPDATE wallet:", err3);
            return res.status(500).json({ success: false, message: "Erreur DB mise à jour wallet" });
          }

          const now = new Date();
          pool.query(
            `INSERT INTO blok_list (hash, user_id, date, usdt) VALUES ($1, $2, $3, $4)`,
            [txId, userId, now, amount],
            (err4) => {
              if (err4) {
                console.error("❌ Erreur INSERT blok-list:", err4);
                return res.status(500).json({ success: false, message: "Erreur DB ajout blok-list" });
              }

              console.log(`✅ Dépôt confirmé: user ${userId}, +${amount} USDT, hash ${txId}`);
              return res.status(200).json({ success: true, amount, txId, newSolde });
            }
          );
        });
      });
    });
  } catch (error) {
    console.error('❌ Erreur serveur:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur: ' + error.message });
  }
});

app.post("/create-deposit", (req, res) => {
  const { txId, amount, userId } = req.body;
  if (!txId || !amount || !userId) {
    return res.status(400).json({ success: false, message: "Données invalides" });
  }

  const now = new Date();

  pool.query(
    `INSERT INTO deposits (hash, user_id, usdt, date, status) VALUES ($1, $2, $3, $4, 'wait')`,
    [txId, userId, amount, now],
    (err) => {
      if (err) {
        console.error("❌ Erreur INSERT deposit:", err.message);
        return res.status(500).json({ success: false, message: "Erreur DB" });
      }
      console.log(`📥 Nouvelle demande dépôt: ${txId}, user ${userId}, ${amount} USDT`);
      return res.status(200).json({ success: true, message: "Demande créée avec succès" });
    }
  );
});

// === Vérification automatique des dépôts toutes les 30s ===
const MAX_PER_CYCLE = 5;
const VERIFY_INTERVAL = 30000;

function updateClientBalance(userId, newBalance) {
  io.emit("balanceUpdated", { userId, newBalance });
}

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  pool.query(sql, params, (err, result) => err ? reject(err) : resolve(result.rows));
});
const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  pool.query(sql, params, (err, result) => err ? reject(err) : resolve(result.rows[0] || null));
});
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  pool.query(sql, params, (err, result) => err ? reject(err) : resolve(result));
});

async function verifyPendingDeposits() {
  try {
    const deposits = await dbAll(
      `SELECT * FROM deposits WHERE status = 'wait' ORDER BY date ASC LIMIT $1`,
      [MAX_PER_CYCLE]
    );

    if (deposits.length === 0) {
      return console.log("ℹ️ Aucune demande à vérifier.");
    }

    for (const deposit of deposits) {
      const { hash: txId, usdt: amount, user_id: userId } = deposit;
      const nowStr = new Date();

      try {
        const exist = await dbGet(`SELECT * FROM blok_list WHERE hash = $1`, [txId]);
        if (exist) {
          const notifId = crypto.randomUUID();
          const notifMessage = `Cher ${userId}, le hash que vous avez fourni (${txId}) a déjà été utilisé. Votre dépôt ne peut pas être traité.`;
          await dbRun(
            `INSERT INTO notifi (id, user_id, valide, date, lecture) VALUES ($1, $2, $3, $4, $5)`,
            [notifId, userId, notifMessage, nowStr, 'no']
          );
          await dbRun(`DELETE FROM deposits WHERE hash = $1`, [txId]);
          console.log(`❌ Dépôt refusé (hash déjà utilisé): ${txId}`);
          continue;
        }

        const txUrl = `https://api.etherscan.io/v2/api?module=proxy&action=eth_getTransactionByHash&txhash=${txId}&chainid=137&apikey=${POLYGONSCAN_V2_API_KEY}`;
        const txResponse = await axios.get(txUrl);
        const txData = txResponse.data?.result;

        if (!txData) {
          const notifId = crypto.randomUUID();
          const notifMessage = `Cher ${userId}, nous n'avons pas pu trouver de transaction correspondant au hash que vous avez fourni (${txId}). Votre dépôt n'a pas été traité.`;
          await dbRun(
            `INSERT INTO notifi (id, user_id, valide, date, lecture) VALUES ($1, $2, $3, $4, $5)`,
            [notifId, userId, notifMessage, nowStr, 'no']
          );
          await dbRun(`DELETE FROM deposits WHERE hash = $1`, [txId]);
          console.log(`❌ Dépôt refusé (transaction non trouvée): ${txId}`);
          continue;
        }

        const input = txData.input?.toLowerCase();
        const toLower = txData.to?.toLowerCase();
        const txAmountHex = '0x' + (input?.slice(74, 138) || '');
        const txAmount = txAmountHex && txAmountHex !== '0x' ? parseInt(txAmountHex, 16) / 1e6 : 0;
        const recipientHex = input?.slice(34, 74) || '';
        const recipient = recipientHex ? '0x' + recipientHex.slice(-40) : '';

        if (toLower !== USDT_CONTRACT || !input?.startsWith(TRANSFER_METHOD_ID) || recipient.toLowerCase() !== DEPOSIT_ADDRESS) {
          const notifId = crypto.randomUUID();
          const notifMessage = `Cher ${userId}, la transaction (${txId}) n'est pas un dépôt USDT valide. Dépôt refusé.`;
          await dbRun(
            `INSERT INTO notifi (id, user_id, valide, date, lecture) VALUES ($1, $2, $3, $4, $5)`,
            [notifId, userId, notifMessage, nowStr, 'no']
          );
          await dbRun(`DELETE FROM deposits WHERE hash = $1`, [txId]);
          console.log(`❌ Dépôt refusé (transaction invalide): ${txId}`);
          continue;
        }

        const receiptUrl = `https://api.etherscan.io/v2/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txId}&chainid=137&apikey=${POLYGONSCAN_V2_API_KEY}`;
        const receiptResponse = await axios.get(receiptUrl);
        const receipt = receiptResponse.data?.result;

        if (!receipt || receipt.status !== '0x1') {
          const notifId = crypto.randomUUID();
          const notifMessage = `Cher ${userId}, la transaction (${txId}) n'a pas été confirmée sur la blockchain. Dépôt refusé.`;
          await dbRun(
            `INSERT INTO notifi (id, user_id, valide, date, lecture) VALUES ($1, $2, $3, $4, $5)`,
            [notifId, userId, notifMessage, nowStr, 'no']
          );
          await dbRun(`DELETE FROM deposits WHERE hash = $1`, [txId]);
          console.log(`❌ Dépôt refusé (transaction non confirmée): ${txId}`);
          continue;
        }

        const tolerance = 0.03;
        if (Math.abs(txAmount - amount) > tolerance) {
          const notifId = crypto.randomUUID();
          const notifMessage = `Cher ${userId}, le montant envoyé (${txAmount} USDT) ne correspond pas au montant indiqué (${amount} USDT). Dépôt refusé.`;
          await dbRun(
            `INSERT INTO notifi (id, user_id, valide, date, lecture) VALUES ($1, $2, $3, $4, $5)`,
            [notifId, userId, notifMessage, nowStr, 'no']
          );
          await dbRun(`DELETE FROM deposits WHERE hash = $1`, [txId]);
          console.log(`❌ Dépôt refusé (montant incorrect): ${txId}`);
          continue;
        }

        const walletRow = await dbGet(`SELECT wallet_total FROM wallet_users WHERE user_id = $1`, [userId]);
        const currentSolde = walletRow ? parseFloat(walletRow.wallet_total) : 0;
        const newSolde = currentSolde + amount;

        await dbRun(`UPDATE wallet_users SET wallet_total = $1 WHERE user_id = $2`, [newSolde, userId]);
        await dbRun(`INSERT INTO blok_list (hash, user_id, date, usdt) VALUES ($1, $2, $3, $4)`, [txId, userId, nowStr, amount]);
        await dbRun(`DELETE FROM deposits WHERE hash = $1`, [txId]);

        const notifId = crypto.randomUUID();
        const notifMessage = `Cher ${userId}, votre dépôt de ${amount} USDT a été validé. Nouveau solde: ${newSolde} USDT.`;
        await dbRun(
          `INSERT INTO notifi (id, user_id, valide, date, lecture) VALUES ($1, $2, $3, $4, $5)`,
          [notifId, userId, notifMessage, nowStr, 'no']
        );

        updateClientBalance(userId, newSolde);
        console.log(`✅ Dépôt validé et notification envoyée: ${txId}`);
      } catch (error) {
        console.error(`❌ Erreur vérification dépôt ${txId}:`, error?.message || error);
      }
    }
  } catch (err) {
    console.error("❌ verifyPendingDeposits erreur globale :", err);
  }
}

setInterval(verifyPendingDeposits, VERIFY_INTERVAL);

// 🚀 Notifications
app.get("/api/notifications/:userId", (req, res) => {
  const { userId } = req.params;
  pool.query(
    `SELECT id, valide, date, lecture FROM notifi WHERE user_id = $1 ORDER BY date DESC`,
    [userId],
    (err, result) => {
      if (err) {
        console.error("❌ Erreur récupération notifications :", err.message);
        return res.status(500).json({ error: "Erreur serveur" });
      }
      res.json(result.rows);
    }
  );
});

app.post("/api/notifications/mark-read", (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "UserId manquant" });

  pool.query(
    `UPDATE notifi SET lecture = 'oui' WHERE user_id = $1 AND lecture = 'no'`,
    [userId],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, updated: result.rowCount });
    }
  );
});

// === FIN ===
// Démarrer l'appli après l'init de la DB
initializeDatabase()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`🚀 Backend + WebSocket lancé sur le port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ Impossible de démarrer l'application :", err);
    process.exit(1); // Arrêter si la DB est essentielle
  });