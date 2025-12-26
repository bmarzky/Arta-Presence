// approveUser.js
const { MessageMedia } = require('whatsapp-web.js');
const { sendTyping } = require('../../utils/sendTyping');
const getGreeting = require('../../data/greetingTime');
const fs = require('fs');
const path = require('path');

// folder TTD
const ttdFolder = path.join(__dirname, '../../assets/ttd/');
if (!fs.existsSync(ttdFolder)) fs.mkdirSync(ttdFolder, { recursive: true });

module.exports = async function approveUser(chat, user, db) {
    const query = (sql, params = []) =>
        new Promise((res, rej) =>
            db.query(sql, params, (e, r) => (e ? rej(e) : res(r)))
        );

    const nama_user = user.pushname || user.nama_wa || 'Arta';
    const user_id = user.id;
    const wa_number = user.wa_number; // pastikan sesuai kolom db

    if (!user_id)
        return sendTyping(chat, 'ID user tidak tersedia.');

    try {
        /* =====================================================
           CEK TTD USER (PNG / JPG)
        ===================================================== */
        const ttdPng = path.join(ttdFolder, `${wa_number}.png`);
        const ttdJpg = path.join(ttdFolder, `${wa_number}.jpg`);
        let ttdExists = false;
        if (fs.existsSync(ttdPng)) ttdExists = true;
        else if (fs.existsSync(ttdJpg)) ttdExists = true;

        if (!ttdExists) {
            await sendTyping(
                chat,
                `Kamu belum mengunggah TTD. Silakan kirim gambar TTD dalam format PNG atau JPG.\n` +
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
           CEK STATUS APPROVAL
        ===================================================== */
        if (!approval) {
            return sendTyping(
                chat,
                'Kamu belum menyiapkan laporan.\nSilakan ketik */export* terlebih dahulu.'
            );
        }

        if (approval.status === 'revised') {
            return sendTyping(
                chat,
                'Laporan kamu *perlu revisi*.\nSilakan perbaiki lalu */export* ulang.'
            );
        }

        if (approval.status === 'approved') {
            return sendTyping(
                chat,
                'Laporan kamu bulan ini sudah *DISETUJUI*.\nTidak bisa diajukan kembali.'
            );
        }

        if (approval.status !== 'pending') {
            return sendTyping(
                chat,
                'Laporan tidak dalam status pending approval.'
            );
        }

        /* =====================================================
           CEK FILE EXPORT
        ===================================================== */
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
        if (!approverWA) return sendTyping(chat, 'Nomor approver belum disetel.');
        if (!approverWA.includes('@')) approverWA += '@c.us';

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
