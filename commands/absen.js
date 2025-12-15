const moment = require('moment');
const { sendTyping } = require('../utils/sendTyping');

module.exports = async function handleAbsen(chat, user, lowerMsg, pesan, query) {
    const today = moment().format('YYYY-MM-DD');
    const nowTime = moment().format('HH:mm');

    // --- Ambil absensi hari ini ---
    const rows = await query(`SELECT * FROM absensi WHERE user_id=? AND tanggal=?`, [user.id, today]);
    const todayAbsen = rows[0];

    // --- Step absen ---
    if (user.step_absen) {
        switch (user.step_absen) {
            case 'ket_masuk':
                if (lowerMsg === 'ya') {
                    await query("UPDATE users SET step_absen='isi_ket' WHERE id=?", [user.id]);
                    return sendTyping(chat, 'Silakan tulis keterangan kerja hari ini:');
                } else {
                    await query("UPDATE users SET step_absen=NULL WHERE id=?", [user.id]);
                    return sendTyping(chat, `Absen MASUK tersimpan pada ${todayAbsen ? todayAbsen.jam_masuk : nowTime}`);
                }

            case 'isi_ket':
                await query(`UPDATE absensi SET deskripsi=? WHERE user_id=? AND tanggal=?`, [pesan, user.id, today]);
                await query("UPDATE users SET step_absen=NULL WHERE id=?", [user.id]);
                await sendTyping(chat, 'Keterangan berhasil disimpan.');
                return sendTyping(chat, 'Jangan lupa untuk absen saat pulang');

            case 'isi_ket_pulang':
                await query(`UPDATE absensi SET deskripsi=? WHERE user_id=? AND tanggal=?`, [pesan, user.id, today]);
                await query("UPDATE users SET step_absen='konfirmasi_pulang' WHERE id=?", [user.id]);
                await sendTyping(chat, 'Keterangan tersimpan.');
                return sendTyping(chat, 'Mau absen PULANG sekarang? (ya/tidak)');

            case 'konfirmasi_pulang':
                if (lowerMsg === 'ya') {
                    await query(`UPDATE absensi SET jam_pulang=CURTIME() WHERE user_id=? AND tanggal=?`, [user.id, today]);
                    await query("UPDATE users SET step_absen=NULL WHERE id=?", [user.id]);
                    await sendTyping(chat, `Absen PULANG berhasil pada ${nowTime}`);
                    return sendTyping(chat, `Besok aku akan ingatkan kamu jam 8.30, untuk absen kembali ya!`);
                } else {
                    await query("UPDATE users SET step_absen=NULL WHERE id=?", [user.id]);
                    return sendTyping(chat, 'Absen pulang dibatalkan.');
                }
        }
    }

    // --- hanya untuk /absen ---
    if (lowerMsg !== '/absen') return;

    if (!todayAbsen) {
        // Belum absen sama sekali hari ini
        await query(`INSERT INTO absensi (user_id, tanggal, jam_masuk) VALUES (?, ?, CURTIME())`, [user.id, today]);
        await query("UPDATE users SET step_absen='ket_masuk' WHERE id=?", [user.id]);
        await sendTyping(chat, `Absen MASUK berhasil pada ${nowTime}`);
        return sendTyping(chat, 'Mau tambahkan keterangan? (ya/tidak)');
    }

    if (todayAbsen.jam_masuk && !todayAbsen.jam_pulang) {
        // Jam pulang belum ada
        if (!todayAbsen.deskripsi) {
            // Belum ada keterangan sama sekali
            await query("UPDATE users SET step_absen='isi_ket_pulang' WHERE id=?", [user.id]);
            await sendTyping(chat, 'Kamu belum mengisi keterangan kerja hari ini.');
            return sendTyping(chat, 'Silakan isi keterangan sekarang sebelum absen pulang.');
        } else {
            // Keterangan sudah ada, tinggal konfirmasi pulang
            await query("UPDATE users SET step_absen='konfirmasi_pulang' WHERE id=?", [user.id]);
            return sendTyping(chat, `Mau absen PULANG sekarang? (ya/tidak)`);
        }
    }

    return sendTyping(chat, 'Absensi hari ini sudah lengkap.');
};
