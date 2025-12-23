const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();
const axios = require("axios");
const crypto = require("crypto");
const { Web3 } = require("web3");
const { Pool } = require("pg");

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
  socket.on("disconnect", () => {
    console.log("🔴 Utilisateur déconnecté :", socket.id);
  });
});

// === CONNEXION POSTGRESQL ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.query("SELECT NOW()", (err, res) => {
  if (err) console.error("❌ Erreur connexion PostgreSQL :", err);
  else console.log("✅ Connecté à PostgreSQL");
});

// === CONFIG ===
const DEPOSIT_ADDRESS = (process.env.DEPOSIT_ADDRESS || '0xe3578e7cbfc81ed8e7ae572764f8373cd8182de5').toLowerCase();
const USDT_CONTRACT = (process.env.USDT_CONTRACT || '0xc2132d05d31c914a87c6611c10748aeb04b58e8f').toLowerCase();
const TRANSFER_METHOD_ID = "0xa9059cbb";
const POLYGONSCAN_V2_API_KEY = process.env.POLYGONSCAN_V2_API_KEY || 'IQDKTTZNTG6EXB341ZS28Q3Y1XHEXE11PT';

const web3 = new Web3(process.env.POLYGON_RPC_URL || 'https://polygon-mainnet.infura.io/v3/VIQDKTTZNTG6EXB341ZS28Q3Y1XHEXE11PT');

// === FONCTIONS ===

function saveUser(user, callback) {
  const dateNow = new Date();
  pool.query("SELECT * FROM users WHERE id = $1", [user.id], (err, result) => {
    if (err) return callback({ success: false, message: "Erreur DB ❌" });
    const row = result.rows[0];

    const proceedWallet = () => {
      pool.query("SELECT * FROM wallet_users WHERE user_id = $1", [user.id], (err2, walletResult) => {
        if (err2) return console.error("❌ Erreur DB wallet_users :", err2.message);
        if (walletResult.rows.length === 0) {
          pool.query(
            `INSERT INTO wallet_users (user_id, username, wallet_total, gain, perte, last_update)
             VALUES ($1, $2, 0, 0, 0, $3)`,
            [user.id, user.username || "", dateNow],
            (err3) => {
              if (err3) console.error("❌ Erreur insertion wallet_users :", err3.message);
              else console.log(`✅ Wallet créé pour : ${user.username || user.name}`);
            }
          );
        }
      });
    };

    if (row) {
      proceedWallet();
      return callback({ success: true, message: "Utilisateur déjà inscrit ✅", user: row });
    } else {
      pool.query(
        `INSERT INTO users (id, username, name, inscription_date, promo_code)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, user.username || "", user.name || "", dateNow, ""],
        (err) => {
          if (err) return callback({ success: false, message: "Erreur insertion ❌" });
          proceedWallet();
          callback({
            success: true,
            message: "Nouvel utilisateur ajouté ✅",
            user: { id: user.id, username: user.username, name: user.name, inscription_date: dateNow, promo_code: "" }
          });
        }
      );
    }
  });
}

function updateClientBalance(userId, newBalance) {
  io.emit("balanceUpdated", { userId, newBalance });
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
  pool.query("SELECT * FROM betdays", (err, result) => {
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
        pool.query(
          `INSERT INTO accept_pari (id_unique, id_user, id_pari, mis_pari, reponse_pari, statu_pari, date_pari)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id_unique, userId, betId, mise, reponse, "Accepter", dateNow],
          (err3) => {
            if (err3) return res.status(500).json({ success: false, message: "Erreur serveur insertion ❌" });

            pool.query("SELECT * FROM betdays WHERE id = $1", [betId], (errBet, betResult) => {
              if (errBet) return console.error("❌ Erreur récupération betDays :", errBet.message);
              const bet = betResult.rows[0];
              if (!bet) return;

              let colUpdate;
              if (reponse === bet.reponse1) colUpdate = "total_reponse1";
              else if (reponse === bet.reponse2) colUpdate = "total_reponse2";
              else return console.error("⚠️ Réponse invalide :", reponse);

              pool.query(
                `UPDATE betdays SET total_particip = total_particip + 1, ${colUpdate} = ${colUpdate} + 1 WHERE id = $1`,
                [betId],
                (err4) => {
                  if (err4) console.error("❌ Erreur update betDays :", err4.message);
                  pool.query("SELECT * FROM betdays WHERE id = $1", [betId], (err5, updatedResult) => {
                    if (!err5 && updatedResult.rows[0]) io.emit("betUpdated", updatedResult.rows[0]);
                  });
                }
              );
            });

            io.emit("balanceUpdated", { userId, newBalance: newSolde });
            res.json({ success: true, message: `Mise de ${mise}$ placée sur "${reponse}" ✅`, newSolde });
          }
        );
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
    if (err) return res.status(500).json({ success: false, message: "Erreur DB accept_pari ❌" });
    const acceptedBets = acceptedResult.rows;
    if (acceptedBets.length === 0) return res.json({ success: true, acceptedBets: [], betDays: [] });

    const betIds = acceptedBets.map(b => b.id_pari);
    const placeholders = betIds.map((_, i) => `$${i + 1}`).join(",");
    pool.query(`SELECT * FROM betdays WHERE id IN (${placeholders})`, betIds, (err2, betDaysResult) => {
      if (err2) return res.status(500).json({ success: false, message: "Erreur DB betDays ❌" });
      res.json({ success: true, acceptedBets, betDays: betDaysResult.rows });
    });
  });
});

app.get("/api/get-user-info", (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ success: false, message: "ID requis" });
  pool.query(
    `SELECT id, username, name, inscription_date, promo_code FROM users WHERE id = $1`,
    [id],
    (err, result) => {
      if (err) return res.status(500).json({ success: false, message: "Erreur serveur" });
      const row = result.rows[0];
      if (!row) return res.status(404).json({ success: false, message: "Utilisateur non trouvé" });
      res.json(row);
    }
  );
});

app.post("/api/update-user", (req, res) => {
  const { id, field, value } = req.body;
  if (!id || !field || value === undefined) return res.status(400).json({ success: false, message: "Champs manquants" });
  const allowedFields = ["name", "promo_code"];
  if (!allowedFields.includes(field)) return res.status(400).json({ success: false, message: "Champ non autorisé" });

  pool.query(`UPDATE users SET ${field} = $1 WHERE id = $2`, [value, id], (err, result) => {
    if (err) return res.status(500).json({ success: false, message: "Erreur DB" });
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: "Utilisateur non trouvé" });
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
      if (err) return res.status(500).json({ error: "Erreur serveur DB" });
      const row = result.rows[0];
      if (!row) {
        pool.query(
          `INSERT INTO wallet_users (user_id, username, wallet_total, gain, perte, last_update)
           VALUES ($1, $2, 0, 0, 0, NOW())`,
          [userId, "unknown"],
          (insertErr) => {
            if (insertErr) return res.status(500).json({ error: "Impossible de créer le wallet" });
            res.json({
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
    return res.status(400).json({ success: false, message: 'Données invalides' });
  }

  try {
    const txUrl = `https://api.polygonscan.com/api?module=proxy&action=eth_getTransactionByHash&txhash=${txId}&apikey=${POLYGONSCAN_V2_API_KEY}`;
    const txResp = await axios.get(txUrl);
    const txData = txResp.data.result;
    if (!txData) return res.status(404).json({ success: false, message: 'Transaction non trouvée' });

    const input = txData.input?.toLowerCase();
    const toLower = txData.to?.toLowerCase();
    if (toLower !== USDT_CONTRACT || !input?.startsWith(TRANSFER_METHOD_ID)) {
      return res.status(400).json({ success: false, message: 'Pas un dépôt USDT valide' });
    }

    const txAmountHex = '0x' + input.slice(74, 138);
    const txAmount = parseInt(txAmountHex, 16) / 1e6;
    const recipient = '0x' + input.slice(34, 74).slice(-40);
    if (recipient.toLowerCase() !== DEPOSIT_ADDRESS) {
      return res.status(400).json({ success: false, message: 'Adresse destinataire incorrecte' });
    }

    const receiptUrl = `https://api.polygonscan.com/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txId}&apikey=${POLYGONSCAN_V2_API_KEY}`;
    const receiptResp = await axios.get(receiptUrl);
    const receipt = receiptResp.data.result;
    if (!receipt || receipt.status !== '0x1') {
      return res.status(400).json({ success: false, message: 'Transaction non confirmée' });
    }

    const tolerance = 0.01;
    if (Math.abs(txAmount - amount) > tolerance) {
      return res.status(400).json({ success: false, message: `Montant invalide` });
    }

    const hashExists = await pool.query(`SELECT hash FROM blok_list WHERE hash = $1`, [txId]);
    if (hashExists.rows.length > 0) {
      return res.status(400).json({ success: false, message: "Hash déjà utilisé !" });
    }

    const wallet = await pool.query(`SELECT wallet_total FROM wallet_users WHERE user_id = $1`, [userId]);
    const currentSolde = wallet.rows[0] ? parseFloat(wallet.rows[0].wallet_total) : 0;
    const newSolde = currentSolde + amount;

    await pool.query(`UPDATE wallet_users SET wallet_total = $1 WHERE user_id = $2`, [newSolde, userId]);
    await pool.query(`INSERT INTO blok_list (hash, user_id, date, usdt) VALUES ($1, $2, NOW(), $3)`, [txId, userId, amount]);

    console.log(`✅ Dépôt confirmé: user ${userId}, +${amount} USDT, hash ${txId}`);
    res.status(200).json({ success: true, amount, txId, newSolde });
  } catch (error) {
    console.error('❌ Erreur serveur:', error.message);
    res.status(500).json({ success: false, message: 'Erreur serveur: ' + error.message });
  }
});

app.post("/create-deposit", (req, res) => {
  const { txId, amount, userId } = req.body;
  if (!txId || !amount || !userId) return res.status(400).json({ success: false, message: "Données invalides" });

  pool.query(
    `INSERT INTO deposits (hash, user_id, usdt, date, status) VALUES ($1, $2, $3, NOW(), 'wait')`,
    [txId, userId, amount],
    (err) => {
      if (err) return res.status(500).json({ success: false, message: "Erreur DB" });
      console.log(`📥 Nouvelle demande dépôt: ${txId}, user ${userId}, ${amount} USDT`);
      res.status(200).json({ success: true, message: "Demande créée avec succès" });
    }
  );
});

// === Vérification automatique toutes les 30s ===
async function verifyPendingDeposits() {
  try {
    const deposits = await pool.query(
      `SELECT hash, user_id, usdt FROM deposits WHERE status = 'wait' ORDER BY date ASC LIMIT 10`
    );
    if (deposits.rows.length === 0) return;

    for (const deposit of deposits.rows) {
      const { hash: txId, user_id: userId, usdt: amount } = deposit;
      try {
        const txUrl = `https://api.polygonscan.com/api?module=proxy&action=eth_getTransactionByHash&txhash=${txId}&apikey=${POLYGONSCAN_V2_API_KEY}`;
        const txResp = await axios.get(txUrl);
        const txData = txResp.data?.result;
        if (!txData) continue;

        const input = txData.input?.toLowerCase();
        const toLower = txData.to?.toLowerCase();
        if (toLower !== USDT_CONTRACT || !input?.startsWith(TRANSFER_METHOD_ID)) continue;

        const txAmount = parseInt('0x' + input.slice(74, 138), 16) / 1e6;
        const recipient = '0x' + input.slice(34, 74).slice(-40);
        if (recipient.toLowerCase() !== DEPOSIT_ADDRESS) continue;

        const receiptUrl = `https://api.polygonscan.com/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txId}&apikey=${POLYGONSCAN_V2_API_KEY}`;
        const receiptResp = await axios.get(receiptUrl);
        const receipt = receiptResp.data?.result;
        if (!receipt || receipt.status !== '0x1') continue;

        if (Math.abs(txAmount - amount) > 0.03) continue;

        const exist = await pool.query(`SELECT hash FROM blok_list WHERE hash = $1`, [txId]);
        if (exist.rows.length > 0) continue;

        const wallet = await pool.query(`SELECT wallet_total FROM wallet_users WHERE user_id = $1`, [userId]);
        const current = wallet.rows[0] ? parseFloat(wallet.rows[0].wallet_total) : 0;
        const newSolde = current + amount;

        await pool.query(`UPDATE wallet_users SET wallet_total = $1 WHERE user_id = $2`, [newSolde, userId]);
        await pool.query(`INSERT INTO blok_list (hash, user_id, date, usdt) VALUES ($1, $2, NOW(), $3)`, [txId, userId, amount]);
        await pool.query(`UPDATE deposits SET status = 'done' WHERE hash = $1`, [txId]);

        updateClientBalance(userId, newSolde);
        console.log(`✅ Dépôt validé: ${txId}`);
      } catch (e) {
        console.error(`❌ Erreur dépôt ${txId}:`, e.message);
      }
    }
  } catch (err) {
    console.error("💥 Erreur globale verifyPendingDeposits:", err);
  }
}

setInterval(verifyPendingDeposits, 30000);

// Notifications
app.get("/api/notifications/:userId", (req, res) => {
  pool.query(
    `SELECT id, valide, date, lecture FROM notifi WHERE user_id = $1 ORDER BY date DESC`,
    [req.params.userId],
    (err, result) => {
      if (err) return res.status(500).json({ error: "Erreur serveur" });
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

// === DÉMARRAGE ===
server.listen(PORT, () => {
  console.log(`🚀 Backend lancé sur http://localhost:${PORT}`);
});