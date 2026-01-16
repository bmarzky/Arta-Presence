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

    // lokasi terakhir
    let lokasiRealtime = 'Lokasi tidak diketahui';

    const lokasiRows = await query(
        `
        SELECT 
            id,
            latitude,
            longitude,
            nama_tempat,
            updated_at
        FROM user_location
        WHERE user_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
        `,
        [user.id]
    );

    if (lokasiRows.length > 0) {
        const loc = lokasiRows[0];
        let namaTempat = loc.nama_tempat;

        // reverse geocoding
        if (!namaTempat && loc.latitude && loc.longitude) {
            namaTempat = await reverseGeocode(loc.latitude, loc.longitude);

            if (namaTempat) {
                await query(
                    `
                    UPDATE user_location
                    SET nama_tempat=?
                    WHERE id=?
                    `,
                    [namaTempat, loc.id]
                );
            }
        }

        lokasiRealtime = `Lokasi Terakhir
- Latitude  : ${loc.latitude}
- Longitude : ${loc.longitude}
- Lokasi    : ${namaTempat || 'Tidak diketahui'}
- Update    : ${moment(loc.updated_at).format('DD-MM-YYYY HH:mm')}`;
    }

    // handle step absen
    if (user.step_absen) {
        switch (user.step_absen) {
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

                return sendTyping(chat, 'Mohon jawab dengan *ya* atau *tidak*');
            }

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
                return sendTyping(chat, 'Mau absen PULANG sekarang?');
            }

            case 'konfirmasi_pulang': {
                if (lowerMsg === 'ya') {
                    await query(
                        `
                        UPDATE absensi 
                        SET jam_pulang=CURTIME(), lokasi=? 
                        WHERE user_id=? AND tanggal=?
                        `,
                        [lokasiRealtime, user.id, today]
                    );

                    await query(
                        "UPDATE users SET step_absen=NULL WHERE id=?",
                        [user.id]
                    );

                    await sendTyping(chat, `Absen PULANG berhasil pada ${nowTime}`);
                    return sendTyping(chat, 'Terima kasih, absensi hari ini sudah lengkap');
                }

                if (lowerMsg === 'tidak') {
                    await query(
                        "UPDATE users SET step_absen=NULL WHERE id=?",
                        [user.id]
                    );
                    return sendTyping(chat, 'Absen pulang dibatalkan.');
                }

                return sendTyping(chat, 'Mohon jawab dengan *ya* atau *tidak* 🙏');
            }
        }
    }


    // Command /absen
    if (lowerMsg === '/absen' || isIntent) {
        if (!todayAbsen) {
            await query(
                `
                INSERT INTO absensi (user_id, tanggal, jam_masuk, lokasi)
                VALUES (?, ?, CURTIME(), ?)
                `,
                [user.id, today, lokasiRealtime]
            );

            await query(
                "UPDATE users SET step_absen='ket_masuk' WHERE id=?",
                [user.id]
            );

            await sendTyping(chat, `Absen MASUK berhasil pada ${nowTime}`);
            return sendTyping(chat, 'Mau tambahkan keterangan?');
        }

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

            return sendTyping(chat, 'Mau absen PULANG sekarang?');
        }

        return sendTyping(chat, 'Absensi hari ini sudah lengkap');
    }

    return;
};
