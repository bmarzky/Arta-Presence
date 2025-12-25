const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../../utils/sendTyping');
const getGreeting = require('../../data/greetingTime');
const fs = require('fs');

module.exports = async function approveUser(chat, user, db) {
    const query = (sql, params) =>
        new Promise((res, rej) =>
            db.query(sql, params, (e, r) => e ? rej(e) : res(r))
        );

    const nama_user = user.pushname || user.nama_wa || 'User';

    // ambil approval pending terakhir dari approvals
    const [approval] = await query(
        `SELECT * FROM approvals 
         WHERE user_id=? AND status='pending'
         ORDER BY created_at DESC
         LIMIT 1`,
        [user.id]
    );

    if (!approval) return sendTyping(chat, 'Belum ada laporan untuk di-approve.');

    // cek file PDF
    if (!fs.existsSync(approval.file_path)) {
        return sendTyping(chat, 'File laporan tidak ditemukan. Silakan export ulang.');
    }

    let approverWA = approval.approver_wa;
    if (!approverWA.includes('@')) approverWA += '@c.us';

    const media = MessageMedia.fromFilePath(approval.file_path);
    const greeting = getGreeting() || '';
    const nama_atasan = approval.nama_atasan || 'Approver';

    try {
        // kirim pesan + PDF ke approver
        await chat.client.sendMessage(
            approverWA,
            `${greeting}\n\n*${nama_user}* meminta approval laporan absensi.\nSilakan diperiksa oleh *${nama_atasan}*.\n\nKetik:\n• approve\n• revisi`
        );

        await chat.client.sendMessage(approverWA, media);

        return sendTyping(chat, `*${nama_user}*, laporan sudah dikirim ke *${nama_atasan}* untuk approval.`);
    } catch (err) {
        console.error('Gagal kirim approval:', err);
        return sendTyping(chat, 'Terjadi kesalahan saat mengirim approval. Cek nomor approver atau koneksi WA.');
    }
};
