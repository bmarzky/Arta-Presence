// index.js
const fs = require('fs');
const path = require('path');

const handleAbsen = require('./absen');
const { handleExport } = require('./export');
const approveUser = require('./approve/approveUser');
const approveAtasan = require('./approve/approveAtasan');

const handleLembur = require('./absensi/lembur');
const handleRiwayatAbsen = require('./absensi/riwayatAbsen');

const greetings = require('../data/greetings');
const greetingReplies = require('../data/greetingReplies');

const waitingTTD = require('../utils/waitingTTD');
const { sendTyping } = require('../utils/sendTyping');
const detectIntentAI = require('../utils/intentAI');
const getWAfinal = require('../utils/getWafinal');

const sendingIntro = {};
const ttdFolder = path.join(__dirname, '../assets/ttd/');
if (!fs.existsSync(ttdFolder)) fs.mkdirSync(ttdFolder, { recursive: true });

const isUserDataComplete = (user) =>
  !!(user.nama_lengkap && user.jabatan && user.nik);

// helper untuk mencegah kirim ke diri sendiri
function getApproverWAfinal(approverWA, userWA) {
  if (!approverWA) return null;
  let final = approverWA.includes('@') ? approverWA : approverWA + '@c.us';
  if (final === userWA + '@c.us') return null; // gak boleh kirim ke diri sendiri
  return final;
}

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

      /* ================= RESTRICTED ================= */
      const firstWord = lowerMsg.replace('/', '').split(' ')[0];
      if (['approve', 'revisi', 'status'].includes(firstWord)) {
        if (user.jabatan !== 'Head West Java Operation')
          return sendTyping(chat, 'Akses terbatas untuk atasan.');
        return approveAtasan(chat, user, pesan, db);
      }

      /* ================= CANCEL ================= */
      if (['batal', 'cancel', 'close', '/cancel'].includes(lowerMsg)) {
        await query(`
          UPDATE users SET
            step_absen=NULL,
            step_lembur=NULL,
            step_riwayat=NULL,
            step_input=NULL,
            export_type=NULL,
            template_export=NULL
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

        // jika waitingTTD untuk atasan
        if (waitingTTD[wa_number]?.approval_id) {
          const [approval] = await query(
            `SELECT a.*, u.wa_number AS user_wa, u.nama_lengkap AS user_nama, u.nik AS user_nik, u.jabatan AS user_jabatan
             FROM approvals a
             JOIN users u ON u.id = a.user_id
             WHERE a.id=?`,
            [waitingTTD[wa_number].approval_id]
          );

          if (!approval) return sendTyping(chat, 'Approval tidak ditemukan.');

          // mencegah kirim ke diri sendiri
        const approverWAfinal = getWAfinal(approval.user_wa, wa_number); // receiver = user bawahan, sender = atasan
        if (!approverWAfinal) return sendTyping(chat, 'Approval gagal: tidak bisa kirim ke diri sendiri.');


          waitingTTD[wa_number] = { approval };
          return approveAtasan(chat, user, null, db, true);
        }

        // jika waitingTTD untuk user
        if (waitingTTD[wa_number]?.user) {
          const approverWAfinal = getApproverWAfinal(waitingTTD[wa_number]?.user?.wa_number, wa_number);
          if (!approverWAfinal) {
            delete waitingTTD[wa_number];
            return sendTyping(chat, 'Approval gagal: tidak bisa kirim ke diri sendiri.');
          }

          delete waitingTTD[wa_number];
          return approveUser(chat, user, db);
        }

        return;
      }

      /* ================= INTRO ================= */
      if (user.intro === 0 && !sendingIntro[wa_number]) {
        sendingIntro[wa_number] = true;
        await sendTyping(chat,
          `Halo *${nama_wa}* 👋
Saya *Arta Presence*, bot absensi otomatis.
Ketik */help* untuk bantuan.`
        );
        await query("UPDATE users SET intro=1 WHERE id=?", [user.id]);
        delete sendingIntro[wa_number];
        return;
      }

      /* ================= HELP ================= */
      if (lowerMsg === '/help')
        return require('./help')(chat, user.nama_wa);

      /* ================= STATE MACHINE (PRIORITAS UTAMA) ================= */
      if (user.step_absen)
        return handleAbsen(chat, user, lowerMsg, pesan, query);

      if (user.step_lembur)
        return handleLembur(chat, user, pesan, db);

      if (user.step_riwayat)
        return handleRiwayatAbsen(chat, user, pesan, db);

      if (user.step_input)
        return handleExport(chat, user, pesan, db, null);

      /* ================= COMMAND (ALIAS INTENT) ================= */
      if (lowerMsg === '/absen')
        return handleAbsen(chat, user, lowerMsg, pesan, query);

      if (lowerMsg === '/riwayat')
        return handleRiwayatAbsen(chat, user, pesan, db);

      if (lowerMsg.startsWith('/export'))
        return handleExport(chat, user, pesan, db, pesan.split(' ')[1] || null);

      /* ================= KIRIM LAPORAN USER ================= */
      if (['kirim'].includes(firstWord)) {
        return approveUser(chat, user, db);
      }

      /* ================= INTENT AI ================= */
      if (!lowerMsg.startsWith('/')) {
        const intent = await detectIntentAI(pesan);
        console.log('[INTENT AI]', pesan, '=>', intent);

        if (intent === 'ABSEN')
          return handleAbsen(chat, user, lowerMsg, pesan, query, true);

        if (intent === 'RIWAYAT')
          return handleRiwayatAbsen(chat, user, pesan, db);

        if (intent === 'EXPORT')
          return handleExport(chat, user, pesan, db, null, true);
      }

      /* ================= GREETING ================= */
      if (greetings[lowerMsg]) {
        const reply =
          greetingReplies[Math.floor(Math.random() * greetingReplies.length)];
        return sendTyping(chat,
          `${greetings[lowerMsg]} *${nama_wa}*, ${reply}`
        );
      }

      /* ================= REVISI ================= */
      if (waitingTTD[wa_number]?.revisi_id) {
        return approveAtasan(chat, user, pesan, db);
      }

      /* ================= FALLBACK ================= */
      await sendTyping(chat, `Aku belum paham pesannya 😅`);
      return sendTyping(chat, 'Coba ketik */help*');

    } catch (err) {
      console.error('[INDEX ERROR]', err);
      return chat.sendMessage('Terjadi kesalahan sistem.');
    }
  }
};
