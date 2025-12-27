// lembur.js
const sessions = {}; // session sementara
const moment = require('moment');
moment.locale('id'); // set locale Indonesia

// Fungsi bantu parsing jam fleksibel termasuk "setengah X"
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

    // Format "setengah X" misal: "setengah 4 pagi", "setengah 6 sore"
    const matchHalf = input.match(/^setengah\s+(\d{1,2})\s*(pagi|siang|sore|malam)?$/);
    if (matchHalf) {
        let num = parseInt(matchHalf[1]);
        const period = matchHalf[2] || 'pagi'; // default pagi jika tidak ada
        m = 30;

        if (period === 'pagi') h = (num - 1) % 12;           // 0-11
        if (period === 'siang') h = ((num % 12) + 12);       // 12-23
        if (period === 'sore') h = ((num % 12) + 12);        // 12-23
        if (period === 'malam') h = ((num % 12) + 18) % 24;  // 18-23
        return { h, m };
    }

    // Format angka + period, misal: "3 pagi", "15:30", "3:45 sore"
    const matchPeriod = input.match(/^(\d{1,2})(:(\d{2}))?\s*(pagi|siang|sore|malam)?$/);
    if (matchPeriod) {
        h = parseInt(matchPeriod[1]);
        m = matchPeriod[3] ? parseInt(matchPeriod[3]) : 0;
        const period = matchPeriod[4];
        if (period === 'pagi') h = h % 12;
        if (period === 'siang') h = (h % 12) + 12;
        if (period === 'sore') h = (h % 12) + 12;
        if (period === 'malam') h = ((h % 12) + 18) % 24;
        return { h, m };
    }

    return null; // gagal parsing
}

module.exports = function handleLembur(chat, user, pesan, query) {
    const userId = user.id;
    const lowerMsg = pesan.trim().toLowerCase();
    const rawText = pesan.trim();

    if (!sessions[userId]) sessions[userId] = { step: null, data: {} };
    const session = sessions[userId];

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

    switch (session.step) {
        case 'input_tanggal': {
            const date = moment(rawText, ['D MMMM YYYY', 'DD MMMM YYYY'], true);
            if (!date.isValid()) return chat.sendMessage('Format tanggal tidak valid. Silakan tulis misal: 28 Desember 2025');
            session.data.tanggal = date.format('YYYY-MM-DD');
            session.step = 'input_jam_mulai';
            query("UPDATE users SET step_lembur=? WHERE id=?", [session.step, userId], (err) => {
                if (err) console.error(err);
                chat.sendMessage('Masukkan jam mulai lembur (misal: 9 pagi, setengah 4 pagi, atau 14:30):');
            });
            break;
        }

        case 'input_jam_mulai': {
            const t = parseFlexibleTime(rawText);
            if (!t) return chat.sendMessage('Format jam salah. Misal: 9 pagi, setengah 4 pagi, atau 14:30');
            session.data.jam_mulai = `${String(t.h).padStart(2,'0')}:${String(t.m).padStart(2,'0')}`;
            session.step = 'input_jam_selesai';
            query("UPDATE users SET step_lembur=? WHERE id=?", [session.step, userId], (err) => {
                if (err) console.error(err);
                chat.sendMessage('Masukkan jam selesai lembur (misal: 5 sore, setengah 6 sore, atau 02:00):');
            });
            break;
        }

        case 'input_jam_selesai': {
            const t = parseFlexibleTime(rawText);
            if (!t) return chat.sendMessage('Format jam salah. Misal: 5 sore, setengah 6 sore, atau 02:00');
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
                chat.sendMessage(
                    `Apakah data berikut sudah benar?\n` +
                    `Tanggal: ${session.data.tanggal}\n` +
                    `Jam: ${session.data.jam_mulai} – ${session.data.jam_selesai}\n` +
                    `Deskripsi: ${session.data.deskripsi}\n(Ketik Ya/Tidak)`
                );
            });
            break;
        }

        case 'confirm': {
            const confirmText = rawText.toLowerCase();
            if (confirmText === 'ya') {
                const [hMulaiH,hMulaiM] = session.data.jam_mulai.split(':').map(Number);
                const [hSelesaiH,hSelesaiM] = session.data.jam_selesai.split(':').map(Number);

                let mulai = hMulaiH + hMulaiM/60;
                let selesai = hSelesaiH + hSelesaiM/60;
                if (selesai < mulai) selesai += 24;
                const totalJam = selesai - mulai;

                query(
                    `SELECT * FROM lembur WHERE user_id=? AND tanggal=? AND jam_mulai=? AND jam_selesai=?`,
                    [userId, session.data.tanggal, session.data.jam_mulai, session.data.jam_selesai],
                    (err, results) => {
                        if (err) {
                            console.error(err);
                            return chat.sendMessage('Terjadi kesalahan saat memeriksa data lembur.');
                        }
                        if (results.length > 0) {
                            return chat.sendMessage('Mohon maaf, jam lembur pada tanggal tersebut sudah tercatat sebelumnya.');
                        }

                        query(
                            `INSERT INTO lembur
                            (user_id, tanggal, jam_mulai, jam_selesai, total_lembur, deskripsi)
                            VALUES (?, ?, ?, ?, ?, ?)`,
                            [userId, session.data.tanggal, session.data.jam_mulai, session.data.jam_selesai, totalJam, session.data.deskripsi],
                            (err2) => {
                                if (err2) {
                                    console.error(err2);
                                    return chat.sendMessage('Terjadi kesalahan saat menyimpan data lembur.');
                                }
                                session.step = null;
                                session.data = {};
                                query("UPDATE users SET step_lembur=NULL WHERE id=?", [userId], (err3) => {
                                    if (err3) console.error(err3);
                                    chat.sendMessage('Data lembur berhasil disimpan.');
                                });
                            }
                        );
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
