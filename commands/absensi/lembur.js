// lembur.js
const sessions = {}; // session sementara
const moment = require('moment');
moment.locale('id'); // set locale Indonesia

/**
 * Fungsi bantu parsing jam fleksibel
 */
function parseFlexibleTime(input) {
    input = input.trim().toLowerCase();
    let h = 0, m = 0;

    // Format HH:MM
    const matchHHMM = input.match(/^(\d{1,2}):(\d{2})$/);
    if (matchHHMM) {
        h = parseInt(matchHHMM[1]);
        m = parseInt(matchHHMM[2]);
        return { h, m };
    }

    // Format "setengah X period" → menit = 30
    const matchSetengah = input.match(/^setengah\s+(\d{1,2})\s*(pagi|siang|sore|malam)$/);
    if (matchSetengah) {
        let num = parseInt(matchSetengah[1]);
        const period = matchSetengah[2];
        m = 30;

        switch(period) {
            case 'pagi':   h = num - 1; break;
            case 'siang':  h = (num % 12) + 12 - 1; break;
            case 'sore':   h = (num % 12) + 12 - 1; break;
            case 'malam':  h = (num % 12) + 12 - 1; break;
        }
        if (h < 0) h += 12;
        return { h, m };
    }

    // Format "X period" → menit = 0
    const matchPeriod = input.match(/^(\d{1,2})\s*(pagi|siang|sore|malam)$/);
    if (matchPeriod) {
        let num = parseInt(matchPeriod[1]);
        const period = matchPeriod[2];
        m = 0;

        switch(period) {
            case 'pagi':   h = num % 12; break;
            case 'siang':  h = (num % 12) + 12; break;
            case 'sore':   h = (num % 12) + 12; break;
            case 'malam':  h = (num % 12) + 12; break;
        }
        return { h, m };
    }

    return null;
}

/**
 * Hitung total jam lembur sebagai string HH:MM
 */
function calculateTotalJam(jamMulai, jamSelesai) {
    const [hMulaiH, hMulaiM] = jamMulai.split(':').map(Number);
    const [hSelesaiH, hSelesaiM] = jamSelesai.split(':').map(Number);

    let mulai = hMulaiH * 60 + hMulaiM;
    let selesai = hSelesaiH * 60 + hSelesaiM;
    if (selesai < mulai) selesai += 24 * 60; // melewati tengah malam
    const totalMenit = selesai - mulai;

    const jam = Math.floor(totalMenit / 60);
    const menit = totalMenit % 60;
    return `${String(jam).padStart(2,'0')}:${String(menit).padStart(2,'0')}`;
}

/**
 * Format total jam ke manusiawi (X jam Y menit)
 */
function formatTotalJamHuman(totalJamHHMM) {
    const [jam, menit] = totalJamHHMM.split(':').map(Number);
    return `${jam} jam ${menit} menit`;
}

// ===========================
// Modul handleLembur
// ===========================
module.exports = function handleLembur(chat, user, pesan, query) {
    const userId = user.id;
    const lowerMsg = pesan.trim().toLowerCase();
    const rawText = pesan.trim();

    if (!sessions[userId]) sessions[userId] = { step: null, data: {} };
    const session = sessions[userId];

    // Start / reset flow
    if (lowerMsg === '/lembur') {
        session.step = 'input_tanggal';
        session.data = {};
        query("UPDATE users SET step_lembur=? WHERE id=?", [session.step, userId], (err) => {
            if (err) console.error(err);
            chat.sendMessage('Silakan masukkan tanggal lembur (misal: 28 Desember 2025):');
        });
        return;
    }

    if (!session.step && user.step_lembur) session.step = user.step_lembur;

    switch(session.step) {
        case 'input_tanggal': {
            const date = moment(rawText, ['D MMMM YYYY', 'DD MMMM YYYY'], true);
            if (!date.isValid()) {
                return chat.sendMessage('Format tanggal tidak valid. Silakan tulis misal: 28 Desember 2025');
            }
            const tanggal = date.format('YYYY-MM-DD');

            // Cek duplikat tanggal langsung
            query(`SELECT * FROM lembur WHERE user_id=? AND tanggal=?`, [userId, tanggal], (err, results) => {
                if (err) return chat.sendMessage('Terjadi kesalahan saat memeriksa tanggal lembur.');
                if (results.length > 0) return chat.sendMessage('Mohon maaf, Anda sudah mencatat lembur pada tanggal tersebut.');

                session.data.tanggal = tanggal;
                session.step = 'input_jam_mulai';
                query("UPDATE users SET step_lembur=? WHERE id=?", [session.step, userId], (err2) => {
                    if (err2) console.error(err2);
                    chat.sendMessage('Masukkan jam mulai lembur (misal: 9 pagi, setengah 4 sore, atau 14:30):');
                });
            });
            break;
        }

        case 'input_jam_mulai': {
            const t = parseFlexibleTime(rawText);
            if (!t) return chat.sendMessage('Format jam salah.');
            session.data.jam_mulai = `${String(t.h).padStart(2,'0')}:${String(t.m).padStart(2,'0')}`;
            session.step = 'input_jam_selesai';
            query("UPDATE users SET step_lembur=? WHERE id=?", [session.step, userId], (err) => {
                if (err) console.error(err);
                chat.sendMessage('Masukkan jam selesai lembur:');
            });
            break;
        }

        case 'input_jam_selesai': {
            const t = parseFlexibleTime(rawText);
            if (!t) return chat.sendMessage('Format jam salah.');
            session.data.jam_selesai = `${String(t.h).padStart(2,'0')}:${String(t.m).padStart(2,'0')}`;
            session.step = 'input_deskripsi';
            query("UPDATE users SET step_lembur=? WHERE id=?", [session.step, userId], (err) => {
                if (err) console.error(err);
                chat.sendMessage('Masukkan deskripsi lembur:');
            });
            break;
        }

        case 'input_deskripsi': {
            session.data.deskripsi = rawText;
            session.step = 'confirm';
            query("UPDATE users SET step_lembur=? WHERE id=?", [session.step, userId], (err) => {
                if (err) console.error(err);

                const tanggalHuman = moment(session.data.tanggal).format('DD MMMM YYYY');
                const totalJamHHMM = calculateTotalJam(session.data.jam_mulai, session.data.jam_selesai);

                const padLabel = (label) => label.padEnd(13, ' ');

                chat.sendMessage(
                    '```' + // mulai monospace
                    '===== Konfirmasi Lembur =====\n' +
                    `${padLabel('Tanggal')} : ${tanggalHuman}\n` +
                    `${padLabel('Jam')} : ${session.data.jam_mulai} – ${session.data.jam_selesai}\n` +
                    `${padLabel('Deskripsi')} : ${session.data.deskripsi}\n` +
                    `${padLabel('Total lembur')} : ${formatTotalJamHuman(totalJamHHMM)}\n` +
                    '============================\n' +
                    '(Ketik Ya/Tidak)' +
                    '```' // tutup monospace
                );

            });
            break;
        }

        case 'confirm': {
            const confirmText = rawText.toLowerCase();
            if (confirmText === 'ya') {
                const totalJamHHMM = calculateTotalJam(session.data.jam_mulai, session.data.jam_selesai);
                query(
                    `INSERT INTO lembur
                    (user_id, tanggal, jam_mulai, jam_selesai, total_lembur, deskripsi)
                    VALUES (?, ?, ?, ?, ?, ?)`,
                    [userId, session.data.tanggal, session.data.jam_mulai, session.data.jam_selesai, totalJamHHMM, session.data.deskripsi],
                    (err2) => {
                        if (err2) return chat.sendMessage('Terjadi kesalahan saat menyimpan data lembur.');
                        session.step = null;
                        session.data = {};
                        query("UPDATE users SET step_lembur=NULL WHERE id=?", [userId], (err3) => {
                            if (err3) console.error(err3);
                            chat.sendMessage('Data lembur berhasil disimpan.');
                        });
                    }
                );
            } else if (confirmText === 'tidak') {
                session.step = 'input_tanggal';
                session.data = {};
                query("UPDATE users SET step_lembur=? WHERE id=?", [session.step, userId], (err) => {
                    if (err) console.error(err);
                    chat.sendMessage('Silakan ulangi input. Masukkan tanggal lembur:');
                });
            } else {
                chat.sendMessage('Ketik Ya atau Tidak untuk konfirmasi.');
            }
            break;
        }
    }
};
