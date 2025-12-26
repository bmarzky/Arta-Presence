// approveUser.js
const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../../utils/sendTyping');
const getGreeting = require('../../data/greetingTime');
const fs = require('fs');
const path = require('path');

module.exports = async function approveUser(chat, user, db) {
    const query = (sql, params) =>
        new Promise((res, rej) =>
            db.query(sql, params, (e, r) => (e ? rej(e) : res(r)))
        );

    const nama_user = user.pushname || user.nama_wa || 'User';
    const user_id = user.id;

    if (!user_id)
        return sendTyping(chat, 'ID user tidak tersedia.');

    try {
        /* =====================================================
           AMBIL APPROVAL TERAKHIR USER
        ===================================================== */
        const [approval] = await query(
            `SELECT *
             FROM approvals
             WHERE user_id=?
             ORDER BY created_at DESC
             LIMIT 1`,
            [user_id]
        );

        /* =====================================================
           BELUM PERNAH EXPORT
        ===================================================== */
        if (!approval) {
            return sendTyping(
                chat,
                '❌ Kamu belum melakukan *export laporan*.\nSilakan ketik */export* terlebih dahulu.'
            );
        }

        /* =====================================================
           SUDAH FINAL (APPROVED / REVISED)
        ===================================================== */
        if (approval.status === 'approved') {
            return sendTyping(
                chat,
                '❌ Laporan kamu sudah *DISETUJUI*. Tidak bisa mengajukan approval lagi.'
            );
        }

        if (approval.status === 'revised') {
            return sendTyping(
                chat,
                '❌ Laporan kamu sudah *DIREVISI*. Silakan perbaiki dan export ulang.'
            );
        }

        /* =====================================================
           FILE EXPORT WAJIB ADA
        ===================================================== */
        if (!approval.file_path) {
            return sendTyping(
                chat,
                '❌ Laporan belum di-export.\nSilakan ketik */export* terlebih dahulu.'
            );
        }

        const filePath = path.resolve(approval.file_path);
        if (!fs.existsSync(filePath)) {
            return sendTyping(
                chat,
                '❌ File laporan tidak ditemukan.\nSilakan export ulang.'
            );
        }

        /* =====================================================
           STATUS HARUS PENDING
        ===================================================== */
        if (approval.status !== 'pending') {
            return sendTyping(
                chat,
                '❌ Laporan tidak dalam status pending approval.'
            );
        }

        /* =====================================================
           KIRIM KE ATASAN
        ===================================================== */
        let approverWA = approval.approver_wa;
        if (!approverWA)
            return sendTyping(chat, 'Nomor approver belum disetel.');

        if (!approverWA.includes('@'))
            approverWA += '@c.us';

        const media = MessageMedia.fromFilePath(filePath);
        const greeting = getGreeting() || '';
        const nama_atasan = approval.nama_atasan || 'Atasan';

        await chat.client.sendMessage(
            approverWA,
            `${greeting}\n\n` +
            `*${nama_user}* meminta *approval laporan absensi*.\n` +
            `Silakan diperiksa oleh *${nama_atasan}*.\n\n` +
            `Ketik:\n• approve\n• revisi`
        );

        await chat.client.sendMessage(approverWA, media);

        return sendTyping(
            chat,
            `✅ *${nama_user}*, laporan berhasil dikirim ke *${nama_atasan}* untuk approval.`
        );

    } catch (err) {
        console.error('Gagal kirim approval:', err);
        return sendTyping(
            chat,
            'Terjadi kesalahan saat mengirim approval.'
        );
    }
};
