// commands/help.js
const { sendTyping } = require('../utils/sendTyping');

module.exports = async function handleHelp(chat, nama_wa) {
    // Pesan pembuka
    await sendTyping(chat, `Halo ${nama_wa}! Berikut daftar perintah yang bisa kamu gunakan:`, 1000);

    // Perintah absensi
    await sendTyping(chat,
`*Perintah Absensi:*
- /absen : Mulai proses absen MASUK/PULANG
- /status : Cek status absensi hari ini *(maintenance)*
- /export : Buat laporan absensi dalam format PDF`
    , 1000);

    // Perintah tambahan
    await sendTyping(chat,
`*Perintah Lain:*
- /info : Perkenalan singkat tentang bot`
    , 1000);

    // Pesan penutup
    await sendTyping(chat, `Silakan ketik perintah sesuai daftar untuk mencoba fitur-fitur yang tersedia.`, 1000);
}
