const sendTypingPerChar = require('../utils/sendTypingPerChar');

module.exports = async function handleHelp(chat, nama_wa) {
    await sendTypingPerChar(chat, `Halo *${nama_wa}* 👋`, 50);
    await sendTypingPerChar(chat, `Berikut daftar perintah yang bisa kamu gunakan di *ARTA PRESENCE*:`, 30);

    await sendTypingPerChar(chat, `* Absensi:*\n• /absen   : Mulai proses absen (MASUK / PULANG)\n• /lembur  : Mulai proses lembur\n• /edit    : Edit data absensi atau lembur\n• /riwayat : Lihat laporan approved sebelumnya`, 30);

    await sendTypingPerChar(chat, `* Export:*\n• /export  : Export laporan Absensi atau Lembur ke PDF`, 30);

    await sendTypingPerChar(chat, `* Pengajuan:*\n• /approve : Kirim laporan ke approval untuk disetujui`, 30);

    await sendTypingPerChar(chat, `* Perintah Lain:*\n• /info    : Info singkat tentang bot *(maintenance)*`, 30);

    await sendTypingPerChar(chat, `Jika mengalami kendala, hubungi author 🤗`, 50);
};
