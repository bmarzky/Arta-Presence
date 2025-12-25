const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../../utils/sendTyping');
const getGreeting = require('../../data/greetingTime');
const fs = require('fs');

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
        return sendTyping(chat, 'Tidak ada laporan yang menunggu approval.');
    }

    // ambil info approver agar bisa tampil nama
    const [approver] = await query(
        `SELECT nama_lengkap FROM users WHERE wa_number = ? LIMIT 1`,
        [approval.approver_wa]
    );

    const approverName = approver?.nama_lengkap || 'Atasan';

    // cek file PDF
    if (!approval.file_path || !fs.existsSync(approval.file_path)) {
        return sendTyping(chat, 'File laporan tidak ditemukan. Silakan export ulang.');
    }
    const media = MessageMedia.fromFilePath(approval.file_path);

    const greeting = getGreeting();

    // 1️⃣ teks pertama: sapaan + info user
    await chat.client.sendMessage(
        approval.approver_wa,
        `${greeting} *${approverName}*,\n` +
        `*${nama_wa}* meminta approval absensi berikut. Silakan diperiksa.`
    );

    // 2️⃣ kirim file PDF
    await chat.client.sendMessage(approval.approver_wa, media);

    // 3️⃣ teks ketiga: instruksi balasan
    await chat.client.sendMessage(
        approval.approver_wa,
        `Silakan balas dengan:
• approve
• revisi`
    );

    // balasan ke user pengirim dokumen
    return sendTyping(chat, `Permintaan approval sudah dikirim ke *${approverName}*.`);
};
