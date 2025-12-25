const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../../utils/sendTyping');
const getGreeting = require('../../data/greetingTime');

module.exports = async function approveUser(chat, user, db) {

    const query = (sql, params) =>
        new Promise((res, rej) =>
            db.query(sql, params, (e, r) => e ? rej(e) : res(r))
        );

    const nama_wa = user.pushname || user.nama_wa || 'User';

    // ambil PDF terakhir
    const [laporan] = await query(
        `SELECT file_path FROM exports 
         WHERE user_id=? ORDER BY created_at DESC LIMIT 1`,
        [user.id]
    );

    if (!laporan) {
        return sendTyping(chat, 'Belum ada laporan untuk di-approve.');
    }

    // nomor atasan (STATIS / DB)
    const approverWA = '62812xxxxxxx@c.us';

    await query(
        `INSERT INTO approvals
         (user_id, approver_wa, file_path, ttd_user_at)
         VALUES (?, ?, ?, NOW())`,
        [user.id, approverWA, laporan.file_path]
    );

    const media = MessageMedia.fromFilePath(laporan.file_path);
    const greeting = getGreeting();

    await chat.client.sendMessage(
        approverWA,
        `${greeting}, *${nama_wa}* meminta approval absensi berikut.\n\n` +
        `Silakan diperiksa.\n\n` +
        `Ketik:\n• approve\n• revisi`
    );

    await chat.client.sendMessage(approverWA, media);

    return sendTyping(
        chat,
        `*${nama_wa}*, laporan sudah dikirim ke atasan untuk approval.`
    );
};
