const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../../utils/sendTyping');
const getGreeting = require('../../data/greetingTime');
const fs = require('fs');

module.exports = async function approveUser(chat, user, db) {

    const query = (sql, params) =>
        new Promise((res, rej) =>
            db.query(sql, params, (e, r) => e ? rej(e) : res(r))
        );

    const nama_user = user.pushname || user.nama_wa || 'Approver';

    // ambil PDF terakhir
    const [laporan] = await query(
        `SELECT file_path FROM exports 
         WHERE user_id=? ORDER BY created_at DESC LIMIT 1`,
        [user.id]
    );

    if (!laporan) {
        return sendTyping(chat, 'Belum ada laporan untuk di-approve.');
    }

    // cek file PDF
    if (!fs.existsSync(laporan.file_path)) {
        return sendTyping(chat, 'File laporan tidak ditemukan di server. Silakan export ulang.');
    }

    // nama atasan statis
    const nama_atasan = 'Asni Juarningsih';
    let approverWA = '62812xxxxxxx'; // nomor WA atasan
    approverWA = approverWA.replace(/@.*/, '') + '@c.us';
    console.log('Approval dikirim ke:', approverWA);

    // simpan ke DB approvals
    await query(
        `INSERT INTO approvals
         (user_id, approver_wa, file_path, ttd_user_at, nama_atasan)
         VALUES (?, ?, ?, NOW(), ?)`,
        [user.id, approverWA, laporan.file_path, nama_atasan]
    );

    // load PDF
    let media;
    try {
        media = MessageMedia.fromFilePath(laporan.file_path);
    } catch (err) {
        console.error('Gagal load file PDF:', err);
        return sendTyping(chat, 'File laporan tidak bisa dibuka.');
    }

    // greeting aman
    let greeting = '';
    try { greeting = getGreeting() || ''; } catch {}

    // kirim pesan dan file
    try {
        await chat.client.sendMessage(
            approverWA,
            `${greeting}\n\n*${nama_user}* meminta approval laporan absensi.\nSilakan diperiksa oleh *${nama_atasan}*.\n\nKetik:\n• approve\n• revisi`
        );

        await chat.client.sendMessage(approverWA, media);

        return sendTyping(
            chat,
            `*${nama_user}*, laporan sudah dikirim ke *${nama_atasan}* untuk approval.`
        );
    } catch (err) {
        console.error('Gagal kirim approval:', err);
        return sendTyping(chat, 'Terjadi kesalahan saat mengirim approval. Silakan cek nomor approver atau koneksi WA.');
    }
};
