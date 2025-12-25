const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../../utils/sendTyping');
const getGreeting = require('../../data/greetingTime');

module.exports = async function approveUser(chat, user, db) {

    const query = (sql, params) =>
        new Promise((res, rej) =>
            db.query(sql, params, (e, r) => e ? rej(e) : res(r))
        );

    const nama_wa = user.pushname || user.nama_wa || 'User';

    // ambil approval pending milik user
    const [approval] = await query(
        `SELECT id, approver_wa, file_path
         FROM approvals
         WHERE user_id = ? AND status = 'pending'
         ORDER BY created_at DESC
         LIMIT 1`,
        [user.id]
    );

    if (!approval) {
        return sendTyping(
            chat,
            'Tidak ada laporan yang menunggu approval.'
        );
    }

    const media = MessageMedia.fromFilePath(approval.file_path);
    const greeting = getGreeting();

    // kirim pesan ke atasan
    await chat.client.sendMessage(
        approval.approver_wa,
        `${greeting}

*${nama_wa}* meminta approval absensi berikut.

Silakan diperiksa.

Balas dengan:
• approve
• revisi`
    );

    await chat.client.sendMessage(approval.approver_wa, media);

    // balasan ke user
    return sendTyping(
        chat,
        'Permintaan approval sudah dikirim ke *${atasan.nama_lengkap}*.'
    );
};
