// index.js
const fs = require('fs');
const path = require('path');

const handleAbsen = require('./absen');
const { handleExport } = require('./export');
const approveUser = require('./approve/approveUser');
const approveAtasan = require('./approve/approveAtasan');

const handleLembur = require('./absensi/lembur');
const handleRiwayat = require('./absensi/riwayatAbsen');
const handleEdit = require('./absensi/editAbsen');

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
  if (final === userWA + '@c.us') return null;
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
      // user init
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

      // restricted
      const firstWord = lowerMsg.replace('/', '').split(' ')[0];
      if (['approve', 'revisi', 'status'].includes(firstWord)) {
        if (user.jabatan !== 'Head West Java Operation')
          return sendTyping(chat, 'Akses terbatas untuk atasan.');
        return approveAtasan(chat, user, pesan, db);
      }

      // global cancel
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

    // media ttd
    if (messageMedia?.mimetype?.startsWith('image/')) {
        const extRaw = messageMedia.mimetype.split('/')[1] || 'png';
        const ext = ['png','jpg','jpeg'].includes(extRaw) ? extRaw : 'png';
        const ttdPath = path.join(ttdFolder, `${wa_number}.${ext}`);
        fs.writeFileSync(ttdPath, messageMedia.data, { encoding: 'base64' });

        // TTD untuk user (kirim laporan)
        if (waitingTTD[wa_number]?.user) {
            // hapus setelah approve selesai
            await approveUser(chat, user, db);
            delete waitingTTD[wa_number];
            return;
        }

        // TTD untuk approval atasan
        if (waitingTTD[wa_number]?.approval_id) { 
            return await approveAtasan(chat, user, null, db);
        }

        // TTD untuk revisi atasan
        if (waitingTTD[wa_number]?.revisi_id) {
            return await approveAtasan(chat, user, null, db);
        }

        return await sendTyping(chat, 'TTD tidak terkait dengan proses apapun.');
    }

      // intro
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

      // help
      if (lowerMsg === '/help')
        return require('./help')(chat, user.nama_wa);

      // state machine
      if (handleEdit.isEditing(wa_number)) {
          return handleEdit(chat, user, pesan, query);
      }

      if (user.step_absen)
          return handleAbsen(chat, user, lowerMsg, pesan, query);

      if (user.step_lembur)
          return handleLembur(chat, user, pesan, db);

      if (user.step_riwayat)
          return handleRiwayat(chat, user, pesan, db);

      if (user.step_input)
          return handleExport(chat, user, pesan, db, null);

      // Command (intent)
      if (lowerMsg === '/absen')
        return handleAbsen(chat, user, lowerMsg, pesan, query);

      if (lowerMsg === '/riwayat')
        return handleRiwayat(chat, user, pesan, db);

      if (lowerMsg === '/edit')
        return handleEdit(chat, user, pesan, query);

      if (lowerMsg.startsWith('/export'))
        return handleExport(chat, user, pesan, db, pesan.split(' ')[1] || null);

      // kirim laporan users
      if (['kirim'].includes(firstWord)) {
        return approveUser(chat, user, db);
      }
      
      // revisi
      if (waitingTTD[wa_number]?.revisi_id) {
        return approveAtasan(chat, user, pesan, db);
      }


      // intent ai
      if (!lowerMsg.startsWith('/')) {
          if (handleEdit.isEditing(wa_number)) {
              return handleEdit(chat, user, pesan, query);
          }

          const intent = await detectIntentAI(pesan);
          console.log('[INTENT AI]', pesan, '=>', intent);

          if (intent === 'ABSEN')
              return handleAbsen(chat, user, lowerMsg, pesan, query, true);

          if (intent === 'LEMBUR')
              return handleLembur(chat, user, pesan, db);

          if (intent === 'RIWAYAT')
              return handleRiwayat(chat, user, pesan, db);

          if (intent === 'EDIT')
              return handleEdit(chat, user, pesan, query);

          if (intent === 'EXPORT')
              return handleExport(chat, user, pesan, db, null, true);

          if (intent === 'REVISI')
              return approveAtasan(chat, user, pesan, db);
      }

      // greetings
      if (greetings[lowerMsg]) {
        const reply =
          greetingReplies[Math.floor(Math.random() * greetingReplies.length)];
        return sendTyping(chat,
          `${greetings[lowerMsg]} *${nama_wa}*, ${reply}`
        );
      }

      // fallback
      await sendTyping(chat, `Aku belum paham pesannya 😅`);
      return sendTyping(chat, 'Coba ketik */help*');

    } catch (err) {
      console.error('[INDEX ERROR]', err);
      return chat.sendMessage('Terjadi kesalahan sistem.');
    }
  }
};
