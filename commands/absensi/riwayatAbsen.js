const { sendTyping } = require('../../utils/sendTyping');

module.exports = async function handleRiwayatAbsen(chat, user, pesan, db) {
    const text = pesan.trim().toLowerCase();

    // helper query PROMISE (WAJIB)
    const query = (sql, params = []) =>
        new Promise((res, rej) =>
            db.query(sql, params, (err, rows) =>
                err ? rej(err) : res(rows)
            )
        );

    /* =========================
       STEP 0 — TRIGGER
    ========================== */
    if (text === '/riwayat') {
        await query(
            `UPDATE users SET step_riwayat='pilih' WHERE id=?`,
            [user.id]
        );

        return sendTyping(chat,
`📚 Ingin melihat riwayat apa?
1. Absen
2. Lembur

Balas: absen atau lembur`
        );
    }

    /* =========================
       STEP 1 — PILIH JENIS
    ========================== */
    if (user.step_riwayat === 'pilih') {

        if (!['absen', 'lembur'].includes(text)) {
            return sendTyping(chat, 'Balas dengan: absen atau lembur');
        }

        // sementara lembur belum
        if (text === 'lembur') {
            await query(
                `UPDATE users SET step_riwayat=NULL WHERE id=?`,
                [user.id]
            );

            return sendTyping(chat, 'Riwayat lembur menyusul 🙏');
        }

        await query(
            `UPDATE users SET step_riwayat='periode' WHERE id=?`,
            [user.id]
        );

        return sendTyping(
            chat,
            'Silakan ketik bulan dan tahun laporan.\nContoh: 12 2024'
        );
    }

    /* =========================
       STEP 2 — INPUT PERIODE
    ========================== */
    if (user.step_riwayat === 'periode') {

        const match = pesan.match(/^(\d{1,2})\s+(\d{4})$/);
        if (!match) {
            return sendTyping(chat, 'Format salah.\nContoh: 12 2024');
        }

        const bulan = Number(match[1]);
        const tahun = Number(match[2]);

        if (bulan < 1 || bulan > 12) {
            return sendTyping(chat, 'Bulan harus antara 1–12');
        }

        /* =========================
           QUERY ABSENSI
        ========================== */
        const data = await query(
            `SELECT *
             FROM absensi
             WHERE user_id=?
               AND MONTH(tanggal)=?
               AND YEAR(tanggal)=?
             ORDER BY tanggal ASC`,
            [user.id, bulan, tahun]
        );

        // RESET STATE (WAJIB)
        await query(
            `UPDATE users SET step_riwayat=NULL WHERE id=?`,
            [user.id]
        );

        if (!data.length) {
            return sendTyping(
                chat,
                'Tidak ada data absen pada periode tersebut.'
            );
        }

        return sendTyping(
            chat,
            `📄 Riwayat absen ${bulan}/${tahun} ditemukan.\n` +
            `Total data: ${data.length}\n\n` +
            `📌 (Export PDF menyusul)`
        );
    }
};
