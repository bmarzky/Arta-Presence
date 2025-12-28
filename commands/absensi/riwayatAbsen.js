const path = require('path');
const fs = require('fs');
const { sendTyping } = require('../../utils/sendTyping');
const { MessageMedia } = require('whatsapp-web.js');

module.exports = async function handleRiwayat(chat, user, pesan, db) {
    const rawText = pesan.trim();
    const text = rawText.toLowerCase();

    // helper query (mysql2 callback → promise)
    const query = (sql, params = []) =>
        new Promise((resolve, reject) =>
            db.query(sql, params, (err, rows) =>
                err ? reject(err) : resolve(rows)
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

        return sendTyping(
            chat,
`Ingin melihat riwayat apa?
1. Absen
2. Lembur

Balas: absen atau lembur`
        );
    }

    // Step 1: pilih jenis
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

    // Step 2: bulan tahun

    if (user.step_riwayat === 'periode') {

        const match = rawText.match(/^(\d{1,2})\s+(\d{4})$/);
        if (!match) {
            return sendTyping(chat, 'Format salah.\nContoh: 12 2025');
        }

        const bulan = Number(match[1]);
        const tahun = Number(match[2]);

        if (bulan < 1 || bulan > 12) {
            return sendTyping(chat, 'Bulan harus antara 1–12');
        }

        const prefix = user.riwayat_jenis === 'lembur'
            ? 'LEMBUR'
            : 'ABSENSI';

        try {
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
                    `${prefix}%`,
                    bulan,
                    tahun
                ]
            );

            if (!laporan) {
                return sendTyping(
                    chat,
                    `Tidak ditemukan laporan ${prefix.toLowerCase()} untuk ${bulan}/${tahun}.`
                );
            }

            const filePath = laporan.file_path.startsWith('/')
                ? laporan.file_path
                : path.join(__dirname, '../../exports', laporan.file_path);

            if (!fs.existsSync(filePath)) {
                return sendTyping(
                    chat,
                    'File tercatat di database, tapi tidak ditemukan di server.'
                );
            }

            await sendTyping(chat, 'Menyiapkan laporan...');
            await chat.sendMessage(
                MessageMedia.fromFilePath(filePath)
            );

        } finally {
            // WAJIB reset state agar user tidak nyangkut
            await query(
                `UPDATE users
                 SET step_riwayat=NULL, riwayat_jenis=NULL
                 WHERE id=?`,
                [user.id]
            );
        }
    }
};
