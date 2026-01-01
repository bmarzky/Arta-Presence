// index.js
const fs = require('fs');
const path = require('path');

const handleAbsen = require('./absen');
const { handleExport } = require('./export');
const approveUser = require('./approve/approveUser');
const approveAtasan = require('./approve/approveAtasan');

const handleLembur = require('./absensi/lembur');
const handleEdit = require('./absensi/editAbsen');
const handleRiwayatAbsen = require('./absensi/riwayatAbsen');

const greetings = require('../data/greetings');
const greetingReplies = require('../data/greetingReplies');

const waitingTTD = require('../utils/waitingTTD');
const { sendTyping } = require('../utils/sendTyping');
const detectIntentAI = require('../utils/intentAI');

const sendingIntro = {};
const ttdFolder = path.join(__dirname, '../assets/ttd/');
if (!fs.existsSync(ttdFolder)) fs.mkdirSync(ttdFolder, { recursive: true });

const typeAndDelay = async (chat, ms = 800, random = 400) => {
  await chat.sendStateTyping();
  await new Promise(r => setTimeout(r, ms + Math.random() * random));
};

const isUserDataComplete = (user) =>
  !!(user.nama_lengkap && user.jabatan && user.nik);

module.exports = {
  message: async (chat, wa_number, nama_wa, db, pesan, messageMedia) => {
    const lowerMsg = pesan.toLowerCase().trim();

    const query = (sql, params = []) =>
      new Promise((res, rej) =>
        db.query(sql, params, (err, result) => err ? rej(err) : res(result))
      );

    try {
      /* ================= USER INIT ================= */
      let [user] = await query(
        "SELECT * FROM users WHERE wa_number=?",
        [wa_number]
      );

      if (!user) {
        await query(
          "INSERT INTO users (wa_number, nama_wa, intro) VALUES (?, ?, 0)",
          [wa_number, nama_wa]
        );
        [user] = await query(
          "SELECT * FROM users WHERE wa_number=?",
          [wa_number]
        );
      } else if (user.nama_wa !== nama_wa) {
        await query(
          "UPDATE users SET nama_wa=? WHERE id=?",
          [nama_wa, user.id]
        );
        user.nama_wa = nama_wa;
      }

      /* ================= RESTRICTED COMMAND ================= */
      const firstWord = lowerMsg.replace('/', '').split(' ')[0];
      const restrictedWords = ['approve', 'revisi', 'status'];

      if (restrictedWords.includes(firstWord)) {
        if (!user.jabatan)
          return sendTyping(chat, 'Data jabatan kamu tidak ditemukan.');

        if (user.jabatan !== 'Head West Java Operation')
          return sendTyping(
            chat,
            'Jabatan anda bukan *Head West Java Operation*,\nakses terbatas untuk approvals.'
          );

        return approveAtasan(chat, user, pesan, db);
      }

      /* ================= CANCEL ================= */
      if (['batal', 'cancel', 'close', '/cancel'].includes(lowerMsg)) {
        await query(`
          UPDATE users SET
            step_input=NULL,
            export_type=NULL,
            template_export=NULL,
            step_absen=NULL,
            step_lembur=NULL,
            step_riwayat=NULL
          WHERE id=?
        `, [user.id]);

        delete waitingTTD[wa_number];
        return sendTyping(chat, 'Proses dibatalkan.');
      }

      /* ================= MEDIA (TTD) ================= */
      if (messageMedia?.mimetype?.startsWith('image/')) {
        const ext = messageMedia.mimetype.split('/')[1] || 'png';
        const filePath = path.join(ttdFolder, `${wa_number}.${ext}`);
        fs.writeFileSync(filePath, messageMedia.data, { encoding: 'base64' });

        if (waitingTTD[wa_number]?.user) {
          delete waitingTTD[wa_number];
          await chat.sendMessage(
            '*File berhasil ditandatangani*\nLaporan akan dikirim ke atasan.'
          );
          return approveUser(chat, user, db);
        }

        if (waitingTTD[wa_number]?.atasan) {
          delete waitingTTD[wa_number];
          await chat.sendMessage(
            '*File berhasil ditandatangani*\nApproval laporan telah selesai.'
          );
          return approveAtasan(chat, user, 'approve', db);
        }

        return;
      }

      /* ================= INTRO ================= */
      if (user.intro === 0) {
        if (sendingIntro[wa_number]) return;

        sendingIntro[wa_number] = true;
        await typeAndDelay(chat);
        await chat.sendMessage(
          `Halo *${nama_wa}* 👋\nSaya *Arta Presence*, bot absensi otomatis.\n\nKetik */help* untuk melihat perintah.`
        );
        await query("UPDATE users SET intro=1 WHERE id=?", [user.id]);
        delete sendingIntro[wa_number];
        return;
      }

      /* ================= HELP ================= */
      if (lowerMsg === '/help')
        return require('./help')(chat, user.nama_wa);

      /* ================= STATE MACHINE (PRIORITAS) ================= */
      if (user.step_absen)
        return handleAbsen(chat, user, lowerMsg, pesan, query);

      if (user.step_lembur)
        return handleLembur(chat, user, pesan, db);

      if (user.step_riwayat)
        return handleRiwayatAbsen(chat, user, pesan, db);

      if (user.step_input)
        return handleExport(chat, user, pesan, db, null);

      /* ================= COMMAND ================= */
      if (lowerMsg === '/approve')
        return approveUser(chat, user, db);

      if (lowerMsg.startsWith('/export')) {
        if (!isUserDataComplete(user)) {
          await query(`
            UPDATE users SET
              step_input=NULL,
              export_type=NULL,
              template_export=NULL
            WHERE id=?
          `, [user.id]);
        }

        const [pending] = await query(`
          SELECT file_path FROM approvals
          WHERE user_id=? AND status='pending'
          ORDER BY created_at DESC LIMIT 1
        `, [user.id]);

        if (pending) {
          const type = pending.file_path?.startsWith('LEMBUR-')
            ? 'LEMBUR'
            : 'ABSENSI';
          return sendTyping(
            chat,
            `Laporan *${type}* masih menunggu approval.`
          );
        }

        await query(
          "DELETE FROM approvals WHERE user_id=? AND status='draft'",
          [user.id]
        );

        const paramBulan = pesan.split(' ')[1] || null;
        return handleExport(chat, user, pesan, db, paramBulan);
      }

      /* ================= INTENT AI (FALLBACK) ================= */
      if (!lowerMsg.startsWith('/')) {
        const intent = await detectIntentAI(pesan);
        console.log('[INTENT AI]', pesan, '=>', intent);

        switch (intent) {
          case 'ABSEN':
            return handleAbsen(chat, user, lowerMsg, pesan, query);
          case 'RIWAYAT':
            return handleRiwayatAbsen(chat, user, pesan, db);
          case 'EXPORT':
            return handleExport(chat, user, pesan, db, null);
          case 'APPROVE':
            return sendTyping(chat, 'Akses approve hanya untuk atasan.');
        }
      }

      /* ================= GREETING ================= */
      if (greetings[lowerMsg]) {
        const reply =
          greetingReplies[Math.floor(Math.random() * greetingReplies.length)];
        return sendTyping(
          chat,
          `${greetings[lowerMsg]} *${nama_wa}*, ${reply}`
        );
      }

      /* ================= FALLBACK ================= */
      await sendTyping(chat, `Hmm… ${nama_wa}, aku belum paham pesannya.`);
      return sendTyping(chat, 'Coba ketik */help* 😊');

    } catch (err) {
      console.error('[INDEX ERROR]', err);
      return chat.sendMessage('Terjadi kesalahan sistem.');
    }
  }
};
