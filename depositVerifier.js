// depositVerifier.js
const axios = require("axios");
require("dotenv").config();

const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_V2_API_KEY;
const DEPOSIT_ADDRESS = process.env.DEPOSIT_ADDRESS?.toLowerCase() || '0xe3578e7cbfc81ed8e7ae572764f8373cd8182de5';
const USDT_CONTRACT = process.env.USDT_CONTRACT?.toLowerCase() || '0xc2132d05d31c914a87c6611c10748aeb04b58e8f';
const TRANSFER_METHOD_ID = "0xa9059cbb";

// Helper: exécuter une requête PostgreSQL avec pool
async function verifyDeposits(pool) {
  try {
    // 1. Récupérer les dépôts en attente
    const depositsRes = await pool.query(
      `SELECT hash, user_id AS id, usdt FROM deposits WHERE status = 'wait'`
    );
    const deposits = depositsRes.rows;

    if (deposits.length === 0) {
      return console.log("ℹ️ Aucun dépôt en attente.");
    }

    for (const deposit of deposits) {
      const { hash: txId, id: userId, usdt: amount } = deposit;

      try {
        // === Vérification transaction ===
        const txUrl = `https://api.polygonscan.com/api?module=proxy&action=eth_getTransactionByHash&txhash=${txId}&apikey=${POLYGONSCAN_API_KEY}`;
        const txResp = await axios.get(txUrl);
        const txData = txResp.data?.result;

        if (!txData) {
          console.log(`⚠️ Transaction ${txId} non trouvée`);
          continue;
        }

        const input = txData.input?.toLowerCase();
        const toLower = txData.to?.toLowerCase();

        if (toLower !== USDT_CONTRACT || !input?.startsWith(TRANSFER_METHOD_ID)) {
          console.log(`❌ Transaction ${txId} pas un dépôt USDT valide`);
          continue;
        }

        const txAmountHex = "0x" + (input?.slice(74, 138) || "0");
        const txAmount = parseInt(txAmountHex, 16) / 1e6;

        const recipientHex = input?.slice(34, 74) || "";
        const recipient = "0x" + recipientHex.slice(-40);
        if (recipient.toLowerCase() !== DEPOSIT_ADDRESS) {
          console.log(`❌ Transaction ${txId} destinataire incorrect`);
          continue;
        }

        // === Vérification receipt ===
        const receiptUrl = `https://api.polygonscan.com/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txId}&apikey=${POLYGONSCAN_API_KEY}`;
        const receiptResp = await axios.get(receiptUrl);
        const receipt = receiptResp.data?.result;

        if (!receipt || receipt.status !== "0x1") {
          console.log(`⚠️ Transaction ${txId} pas encore confirmée`);
          continue;
        }

        // Tolérance de montant
        const tolerance = 0.01;
        if (Math.abs(txAmount - amount) > tolerance) {
          console.log(`❌ Montant incorrect ${txAmount} ≠ ${amount}`);
          continue;
        }

        // === Vérif anti-double dépôt ===
        const blokRes = await pool.query(`SELECT hash FROM blok_list WHERE hash = $1`, [txId]);
        if (blokRes.rows.length > 0) {
          console.log(`⚠️ Transaction ${txId} déjà traitée`);
          continue;
        }

        // === Mise à jour solde ===
        const walletRes = await pool.query(
          `SELECT wallet_total FROM wallet_users WHERE user_id = $1`,
          [userId]
        );
        const current = walletRes.rows[0] ? parseFloat(walletRes.rows[0].wallet_total) : 0;
        const newSolde = current + amount;

        await pool.query(
          `UPDATE wallet_users SET wallet_total = $1 WHERE user_id = $2`,
          [newSolde, userId]
        );

        const now = new Date();
        await pool.query(
          `INSERT INTO blok_list (hash, user_id, date, usdt) VALUES ($1, $2, $3, $4)`,
          [txId, userId, now, amount]
        );

        await pool.query(
          `UPDATE deposits SET status = 'done' WHERE hash = $1`,
          [txId]
        );

        console.log(`✅ Dépôt confirmé: ${txId}, user ${userId}, +${amount} USDT`);

      } catch (err) {
        console.error(`❌ Erreur vérification dépôt ${txId}:`, err.message || err);
      }
    }
  } catch (err) {
    console.error("💥 Erreur globale dans verifyDeposits:", err.message || err);
  }
}

module.exports = verifyDeposits;