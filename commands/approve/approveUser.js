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

    // ambil info approver agar bisa tampil nama
    const [approver] = await query(
        `SELECT nama_lengkap FROM users WHERE wa_number = ? LIMIT 1`,
        [approval.approver_wa]
    );

    // kirim file PDF ke approver
    if (!approval.file_path || !require('fs').existsSync(approval.file_path)) {
        return sendTyping(chat, 'File laporan tidak ditemukan. Silakan export ulang.');
    }
    const media = MessageMedia.fromFilePath(approval.file_path);

    const greeting = getGreeting();
    const approverName = approver?.nama_lengkap || 'Approver';

    // kirim pesan dan file ke approver
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
        `Permintaan approval sudah dikirim ke *${approverName}*.`
    );
};