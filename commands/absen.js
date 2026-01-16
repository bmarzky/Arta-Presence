const moment = require('moment');
const { sendTyping } = require('../utils/sendTyping');
const reverseGeocode = require('../utils/reverseGeocode');

module.exports = async function handleAbsen(
    chat,
    user,
    lowerMsg,
    pesan,
    query,
    isIntent = false
) {
    const today = moment().format('YYYY-MM-DD');
    const nowTime = moment().format('HH:mm');

    // Ambil absensi hari ini
    const rows = await query(
        `SELECT * FROM absensi WHERE user_id=? AND tanggal=?`,
        [user.id, today]
    );
    const todayAbsen = rows[0];

    // menunggu lokasi masuk

    if (user.step_absen === 'minta_lokasi_masuk' && pesan.type === 'location') {
        const { latitude, longitude } = pesan.location;

        const namaTempat = await reverseGeocode(latitude, longitude);

        const lokasiText = `
Lokasi Absen MASUK
- Latitude  : ${latitude}
- Longitude : ${longitude}
- Lokasi    : ${namaTempat || 'Tidak diketahui'}
        `;

        await query(
            `
            INSERT INTO absensi (user_id, tanggal, jam_masuk, lokasi)
            VALUES (?, ?, CURTIME(), ?)
            `,
            [user.id, today, lokasiText]
        );

        await query(
            "UPDATE users SET step_absen='ket_masuk' WHERE id=?",
            [user.id]
        );

        return sendTyping(chat, `Absen MASUK berhasil pada ${nowTime}\nMau tambahkan keterangan?`);
    }

    // menunggu lokasi pulang
    if (user.step_absen === 'minta_lokasi_pulang' && pesan.type === 'location') {
        const { latitude, longitude } = pesan.location;

        const namaTempat = await reverseGeocode(latitude, longitude);

        const lokasiText = `
Lokasi Absen PULANG
- Latitude  : ${latitude}
- Longitude : ${longitude}
- Lokasi    : ${namaTempat || 'Tidak diketahui'}
        `;

        await query(
            `
            UPDATE absensi
            SET jam_pulang=CURTIME(), lokasi=?
            WHERE user_id=? AND tanggal=?
            `,
            [lokasiText, user.id, today]
        );

        await query(
            "UPDATE users SET step_absen=NULL WHERE id=?",
            [user.id]
        );

        return sendTyping(chat, `Absen PULANG berhasil pada ${nowTime}\nTerima kasih 🙏`);
    }

    // step untuk input keterangan masuk/pulang
    if (user.step_absen) {
        switch (user.step_absen) {
            case 'ket_masuk':
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
                    return sendTyping(chat, 'Keterangan dilewati. Jangan lupa absen pulang.');
                }

                return sendTyping(chat, 'Mohon jawab dengan *ya* atau *tidak*');

            case 'isi_ket':
                await query(
                    `UPDATE absensi SET deskripsi=? WHERE user_id=? AND tanggal=?`,
                    [pesan, user.id, today]
                );

                await query(
                    "UPDATE users SET step_absen=NULL WHERE id=?",
                    [user.id]
                );

                return sendTyping(chat, 'Keterangan berhasil disimpan.');

            case 'isi_ket_pulang':
                await query(
                    `UPDATE absensi SET deskripsi=? WHERE user_id=? AND tanggal=?`,
                    [pesan, user.id, today]
                );

                await query(
                    "UPDATE users SET step_absen='konfirmasi_pulang' WHERE id=?",
                    [user.id]
                );

                return sendTyping(chat, 'Keterangan tersimpan. Mau absen PULANG sekarang?');

            case 'konfirmasi_pulang':
                if (lowerMsg === 'ya') {
                    await query(
                        "UPDATE users SET step_absen='minta_lokasi_pulang' WHERE id=?",
                        [user.id]
                    );

                    return sendTyping(
                        chat,
                        'Silakan aktifkan lokasi dan kirim lokasi untuk absen PULANG.'
                    );
                }

                if (lowerMsg === 'tidak') {
                    await query(
                        "UPDATE users SET step_absen=NULL WHERE id=?",
                        [user.id]
                    );
                    return sendTyping(chat, 'Absen pulang dibatalkan.');
                }

                return sendTyping(chat, 'Mohon jawab dengan *ya* atau *tidak*');
        }
    }

    // Command /absen atau Intent Absen
    if (lowerMsg === '/absen' || isIntent) {

        // Belum absen masuk
        if (!todayAbsen) {
            await query(
                "UPDATE users SET step_absen='minta_lokasi_masuk' WHERE id=?",
                [user.id]
            );

            return sendTyping(
                chat,
                'Silakan aktifkan lokasi dan kirim lokasi untuk absen MASUK.'
            );
        }

        // Sudah masuk, belum pulang
        if (todayAbsen.jam_masuk && !todayAbsen.jam_pulang) {
            if (!todayAbsen.deskripsi) {
                await query(
                    "UPDATE users SET step_absen='isi_ket_pulang' WHERE id=?",
                    [user.id]
                );

                return sendTyping(chat, 'Silakan isi keterangan sebelum absen pulang.');
            }

            await query(
                "UPDATE users SET step_absen='konfirmasi_pulang' WHERE id=?",
                [user.id]
            );

            return sendTyping(chat, 'Mau absen PULANG sekarang?');
        }

        return sendTyping(chat, 'Absensi hari ini sudah lengkap');
    }
};
