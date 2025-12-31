// help.js
const { sendTyping } = require('../utils/sendTyping');

module.exports = async function handleHelp(chat, nama_wa) {
    // Pesan pembuka
    await sendTyping(chat, `Halo *${nama_wa}* 👋`, 800);
    await sendTyping(chat, `Berikut daftar perintah yang bisa kamu gunakan di *ARTA PRESENCE*:`, 1000);

    // Absensi
    await sendTyping(chat, `* Absensi:*\n• /absen   : Mulai proses absen (MASUK / PULANG)\n• /lembur  : Mulai proses lembur\n• /edit    : Edit data absensi atau lembur\n• /riwayat : Lihat laporan approved sebelumnya`, 1200);

    // Export
    await sendTyping(chat, `* Export:*\n• /export  : Export laporan Absensi atau Lembur ke PDF`, 1000);

    // Pengajuan
    await sendTyping(chat, `* Pengajuan:*\n• /approve : Kirim laporan ke approval untuk disetujui`, 1000);

    // Perintah Lain
    await sendTyping(chat, `* Perintah Lain:*\n• /info    : Info singkat tentang bot *(maintenance)*`, 1000);

    // Penutup
    await sendTyping(chat, `Jika mengalami kendala, hubungi author 🤗`, 800);
};
