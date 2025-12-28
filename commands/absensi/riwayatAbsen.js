const path = require('path');
const fs = require('fs');
const { sendTyping } = require('../../utils/sendTyping');
const { MessageMedia } = require('whatsapp-web.js');

module.exports = async function handleRiwayat(chat, user, pesan, db) {
    const text = pesan.trim().toLowerCase();

    const query = (sql, params = []) =>
        new Promise((res, rej) =>
            db.query(sql, params, (err, rows) =>
                err ? rej(err) : res(rows)
            )
        );

    /* =====================
       STEP 0 — TRIGGER
    ====================== */
    if (text === '/riwayat') {
        await query(
            `UPDATE users 
             SET step_riwayat='pilih', riwayat_jenis=NULL 
             WHERE id=?`,
            [user.id]
        );

        return sendTyping(chat,
`📚 Ingin melihat riwayat apa?
1. Absen
2. Lembur

Balas: absen atau lembur`
        );
    }

    /* =====================
       STEP 1 — PILIH JENIS
    ====================== */
    if (user.step_riwayat === 'pilih') {

        if (!['absen', 'lembur'].includes(text)) {
            return sendTyping(chat, 'Balas dengan: absen atau lembur');
        }

        await query(
            `UPDATE users 
             SET step_riwayat='periode', riwayat_jenis=? 
             WHERE id=?`,
            [text, user.id]
        );

        return sendTyping(
            chat,
            'Silakan ketik bulan dan tahun laporan.\nContoh: 12 2025'
        );
    }

    /* =====================
       STEP 2 — BULAN & TAHUN
    ====================== */
    if (user.step_riwayat === 'periode') {

        const match = pesan.match(/^(\d{1,2})\s+(\d{4})$/);
        if (!match) {
            return sendTyping(chat, 'Format salah.\nContoh: 12 2025');
        }

        const bulan = Number(match[1]);
        const tahun = Number(match[2]);

        if (bulan < 1 || bulan > 12) {
            return sendTyping(chat, 'Bulan harus antara 1–12');
        }

        const jenis = user.riwayat_jenis === 'lembur'
            ? 'LEMBUR'
            : 'ABSENSI';

        const [laporan] = await query(
            `SELECT file_path
             FROM approvals
             WHERE user_id=?
               AND source='export'
               AND status='approved'
               AND file_path LIKE ?
               AND MONTH(created_at)=?
               AND YEAR(created_at)=?
             ORDER BY created_at DESC
             LIMIT 1`,
            [
                user.id,
                `%${jenis}%`,
                bulan,
                tahun
            ]
        );

        // reset state
        await query(
            `UPDATE users 
             SET step_riwayat=NULL, riwayat_jenis=NULL 
             WHERE id=?`,
            [user.id]
        );

        if (!laporan) {
            return sendTyping(
                chat,
                `Tidak ditemukan laporan ${jenis.toLowerCase()} untuk ${bulan}/${tahun}.`
            );
        }

        const filePath = laporan.file_path.startsWith('/')
            ? laporan.file_path
            : path.join(__dirname, '../../exports', laporan.file_path);

        if (!fs.existsSync(filePath)) {
            return sendTyping(chat, 'File ditemukan di database tapi tidak ada di server.');
        }

        await sendTyping(chat, '📄 Mengirim laporan...');
        await chat.sendMessage(
            MessageMedia.fromFilePath(filePath)
        );
    }
};
