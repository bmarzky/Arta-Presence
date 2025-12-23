const moment = require('moment');
const { sendTyping } = require('../utils/sendTyping');

module.exports = async function handleAbsen(chat, user, lowerMsg, pesan, query) {
    const today = moment().format('YYYY-MM-DD');
    const nowTime = moment().format('HH:mm');

    // Ambil absensi hari ini
    const rows = await query(
        `SELECT * FROM absensi WHERE user_id=? AND tanggal=?`,
        [user.id, today]
    );
    const todayAbsen = rows[0];

    // =========================
    // HANDLE STEP ABSEN
    // =========================
    if (user.step_absen) {
        switch (user.step_absen) {

            // -------------------------
            // KONFIRMASI KETERANGAN MASUK
            // -------------------------
            case 'ket_masuk': {
                if (lowerMsg === 'ya') {
                    await query(
                        "UPDATE users SET step_absen='isi_ket' WHERE id=?",
                        [user.id]
                    );
                    return sendTyping(chat, 'Silakan tulis keterangan kerja hari ini:');
                }

                if (lowerMsg === 'tidak') {
                    await query(
                        "UPDATE users SET step_absen=NULL WHERE id=?",
                        [user.id]
                    );
                    return sendTyping(
                        chat,
                        `Absen MASUK tersimpan pada ${todayAbsen?.jam_masuk || nowTime}`
                    );
                }

                // ❗ JAWABAN TIDAK VALID
                return sendTyping(chat, 'Mohon jawab dengan *ya* atau *tidak* 🙏');
            }

            // -------------------------
            // INPUT KETERANGAN MASUK
            // -------------------------
            case 'isi_ket': {
                await query(
                    `UPDATE absensi SET deskripsi=? WHERE user_id=? AND tanggal=?`,
                    [pesan, user.id, today]
                );

                await query(
                    "UPDATE users SET step_absen=NULL WHERE id=?",
                    [user.id]
                );

                await sendTyping(chat, 'Keterangan berhasil disimpan.');
                return sendTyping(chat, 'Jangan lupa untuk absen saat pulang.');
            }

            // -------------------------
            // INPUT KETERANGAN SEBELUM PULANG
            // -------------------------
            case 'isi_ket_pulang': {
                await query(
                    `UPDATE absensi SET deskripsi=? WHERE user_id=? AND tanggal=?`,
                    [pesan, user.id, today]
                );

                await query(
                    "UPDATE users SET step_absen='konfirmasi_pulang' WHERE id=?",
                    [user.id]
                );

                await sendTyping(chat, 'Keterangan tersimpan.');
                return sendTyping(chat, 'Mau absen PULANG sekarang? (ya/tidak)');
            }

            // -------------------------
            // KONFIRMASI ABSEN PULANG
            // -------------------------
            case 'konfirmasi_pulang': {
                if (lowerMsg === 'ya') {
                    await query(
                        `UPDATE absensi SET jam_pulang=CURTIME() WHERE user_id=? AND tanggal=?`,
                        [user.id, today]
                    );

                    await query(
                        "UPDATE users SET step_absen=NULL WHERE id=?",
                        [user.id]
                    );

                    await sendTyping(chat, `Absen PULANG berhasil pada ${nowTime}`);
                    return sendTyping(
                        chat,
                        'Terima kasih, absensi hari ini sudah lengkap ✅'
                    );
                }

                if (lowerMsg === 'tidak') {
                    await query(
                        "UPDATE users SET step_absen=NULL WHERE id=?",
                        [user.id]
                    );
                    return sendTyping(chat, 'Absen pulang dibatalkan.');
                }

                // ❗ JAWABAN TIDAK VALID
                return sendTyping(chat, 'Mohon jawab dengan *ya* atau *tidak* 🙏');
            }
        }
    }

    // =========================
    // COMMAND /absen SAJA
    // =========================
    if (lowerMsg !== '/absen') return;

    // -------------------------
    // BELUM ABSEN HARI INI
    // -------------------------
    if (!todayAbsen) {
        await query(
            `INSERT INTO absensi (user_id, tanggal, jam_masuk)
             VALUES (?, ?, CURTIME())`,
            [user.id, today]
        );

        await query(
            "UPDATE users SET step_absen='ket_masuk' WHERE id=?",
            [user.id]
        );

        await sendTyping(chat, `Absen MASUK berhasil pada ${nowTime}`);
        return sendTyping(chat, 'Mau tambahkan keterangan? (ya/tidak)');
    }

    // -------------------------
    // SUDAH MASUK, BELUM PULANG
    // -------------------------
    if (todayAbsen.jam_masuk && !todayAbsen.jam_pulang) {

        if (!todayAbsen.deskripsi) {
            await query(
                "UPDATE users SET step_absen='isi_ket_pulang' WHERE id=?",
                [user.id]
            );
            await sendTyping(chat, 'Kamu belum mengisi keterangan kerja hari ini.');
            return sendTyping(
                chat,
                'Silakan isi keterangan sekarang sebelum absen pulang.'
            );
        }

        await query(
            "UPDATE users SET step_absen='konfirmasi_pulang' WHERE id=?",
            [user.id]
        );
        return sendTyping(chat, 'Mau absen PULANG sekarang? (ya/tidak)');
    }

    // -------------------------
    // ABSEN SUDAH LENGKAP
    // -------------------------
    return sendTyping(chat, 'Absensi hari ini sudah lengkap');
};
