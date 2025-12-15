// commands/help.js
const { sendTyping } = require('../utils/sendTyping');

module.exports = async function handleHelp(chat, nama_wa) {
    // Pesan pembuka
    await sendTyping(chat, `Halo ${nama_wa}! Berikut daftar perintah yang bisa kamu gunakan:`, 1000);

    // Perintah absensi
    await sendTyping(chat,
`*Perintah Absensi:*
- /absen : Mulai proses absen MASUK/PULANG
- /status : Cek status absensi hari ini
- /export : Buat laporan absensi dalam format PDF`
    , 1000);

    // Perintah tambahan
    await sendTyping(chat,
`*Perintah Lain:*
- /help : Menampilkan daftar perintah ini
- /jadwal : Menampilkan jadwal kerja (opsional)
- /info : Info singkat tentang bot`
    , 1000);

    // Pesan penutup
    await sendTyping(chat, `Kalau ada yang membingungkan, cukup ketik perintahnya, aku akan bantu menjelaskan.`, 1000);
}
