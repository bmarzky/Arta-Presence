// approveUser.js
const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../../utils/sendTyping');
const getGreeting = require('../../data/greetingTime');
const fs = require('fs');
const path = require('path');

// folder TTD
const ttdFolder = path.resolve('./ttd/');
if (!fs.existsSync(ttdFolder)) fs.mkdirSync(ttdFolder, { recursive: true });

module.exports = async function approveUser(chat, user, db) {
    const query = (sql, params = []) =>
        new Promise((res, rej) =>
            db.query(sql, params, (e, r) => (e ? rej(e) : res(r)))
        );

    const nama_user = user.pushname || user.nama_wa || 'User';
    const user_id = user.id;
    const wa_number = user.wa_number; // pastikan sesuai kolom db

    if (!user_id)
        return sendTyping(chat, 'ID user tidak tersedia.');

    try {
        /* =====================================================
           CEK TTD USER
        ===================================================== */
        const ttdPath = path.join(ttdFolder, `${wa_number}.png`);
        if (!fs.existsSync(ttdPath)) {
            await sendTyping(
                chat,
                `Kamu belum mengunggah TTD. Silakan kirim gambar TTD dalam format PNG.\n` +
                `Setelah dikirim, laporan akan otomatis diajukan.`
            );
            return; // berhenti dulu sampai user kirim TTD
        }

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
                'Kamu belum menyiapkan laporan.\nSilakan ketik */export* terlebih dahulu.'
            );
        }

        /* =====================================================
           JIKA REVISED → WAJIB EXPORT ULANG
        ===================================================== */
        if (approval.status === 'revised') {
            return sendTyping(
                chat,
                'Laporan kamu *perlu revisi*.\nSilakan perbaiki lalu */export* ulang.'
            );
        }

        /* =====================================================
           SUDAH APPROVED
        ===================================================== */
        if (approval.status === 'approved') {
            return sendTyping(
                chat,
                'Laporan kamu bulan ini sudah *DISETUJUI*.\nTidak bisa diajukan kembali.'
            );
        }

        /* =====================================================
           STATUS HARUS PENDING
        ===================================================== */
        if (approval.status !== 'pending') {
            return sendTyping(
                chat,
                'Laporan tidak dalam status pending approval.'
            );
        }

        /* =====================================================
           FILE EXPORT WAJIB ADA
        ===================================================== */
        if (!approval.file_path) {
            return sendTyping(
                chat,
                'Laporan belum di-export.\nSilakan ketik */export* terlebih dahulu.'
            );
        }

        const filePath = path.resolve(approval.file_path);
        if (!fs.existsSync(filePath)) {
            return sendTyping(
                chat,
                'File laporan tidak ditemukan.\nSilakan export ulang.'
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
            `*Permintaan Approval Laporan Absensi*\n\n` +
            `${greeting} *${nama_atasan}*\n\n` +
            `*${nama_user}* meminta permohonan approval untuk laporan absensi.\n` +
            `Mohon untuk diperiksa.`
        );

        await chat.client.sendMessage(approverWA, media);

        await chat.client.sendMessage(
            approverWA,
            `Silakan ketik:\n` +
            `• *approve*\n` +
            `• *revisi*`
        );

        return sendTyping(
            chat,
            `*${nama_user}*, laporan berhasil dikirim ke *${nama_atasan}* untuk proses approval.`
        );

    } catch (err) {
        console.error('Gagal kirim approval:', err);
        return sendTyping(
            chat,
            'Terjadi kesalahan saat mengirim approval.'
        );
    }
};
