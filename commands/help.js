// help.js
const { sendTyping } = require('../utils/sendTyping');

module.exports = async function handleHelp(chat, nama_wa) {
    const pesan = `Halo *${nama_wa}* 👋
Berikut daftar perintah yang bisa kamu gunakan di *ARTA PRESENCE*:

*Absensi:*
\`\`\`
/absen   : Mulai proses absen (MASUK / PULANG)
/lembur  : Mulai proses lembur
/edit    : Edit data absensi atau lembur
/riwayat : Lihat laporan approved sebelumnya
\`\`\`

*Export:*
\`\`\`
/export  : Export laporan Absensi atau Lembur ke PDF
\`\`\`

*Pengajuan:*
\`\`\`
/approve : Kirim laporan ke approval untuk disetujui
\`\`\`

*Perintah Lain:*
\`\`\`
/info    : Info singkat tentang bot *(maintenance)*
\`\`\`

Jika mengalami kendala, hubungi author 🤗`;

    await sendTyping(chat, pesan, 1000);
};
