// NLP/fallback.js
const { NlpManager } = require('node-nlp');
const manager = new NlpManager({ languages: ['id'], forceNER: true });

// Tambahkan intent dan contoh kalimat
manager.addDocument('id', 'help', 'help');
manager.addDocument('id', 'bantuan', 'help');
manager.addDocument('id', 'perintah', 'help');

manager.addDocument('id', 'absen', 'absen');
manager.addDocument('id', 'masuk', 'absen');
manager.addDocument('id', 'pulang', 'absen');

manager.addDocument('id', 'lembur', 'lembur');
manager.addDocument('id', 'overtime', 'lembur');

manager.addDocument('id', 'edit', 'edit');
manager.addDocument('id', 'ubah', 'edit');

manager.addDocument('id', 'riwayat', 'riwayat');
manager.addDocument('id', 'history', 'riwayat');
manager.addDocument('id', 'laporan', 'riwayat');

manager.addDocument('id', 'export', 'export');
manager.addDocument('id', 'pdf', 'export');

manager.addDocument('id', 'approve', 'approve');
manager.addDocument('id', 'setuju', 'approve');
manager.addDocument('id', 'approval', 'approve');

manager.addDocument('id', 'info', 'info');
manager.addDocument('id', 'informasi', 'info');

// Tambahkan jawaban untuk masing-masing intent
manager.addAnswer('id', 'help', 'Kamu bisa menggunakan perintah /help untuk melihat daftar perintah.');
manager.addAnswer('id', 'absen', 'Kamu bisa mulai absen menggunakan /absen.');
manager.addAnswer('id', 'lembur', 'Kamu bisa mulai lembur menggunakan /lembur.');
manager.addAnswer('id', 'edit', 'Gunakan /edit untuk mengubah data absen atau lembur.');
manager.addAnswer('id', 'riwayat', 'Gunakan /riwayat untuk melihat laporan sebelumnya.');
manager.addAnswer('id', 'export', 'Gunakan /export untuk mengekspor laporan ke PDF.');
manager.addAnswer('id', 'approve', 'Gunakan /approve untuk mengajukan laporan ke approval.');
manager.addAnswer('id', 'info', 'Ini adalah bot ARTA PRESENCE untuk membantu absensi dan laporan.');

// Latih model saat bot dijalankan
(async () => {
    await manager.train();
    manager.save(); // Simpan model agar bisa dipakai nanti tanpa train ulang
})();

// Fungsi prediksi intent
async function predictIntent(message) {
    const response = await manager.process('id', message);
    return response.intent === 'None' ? 'unknown' : response.intent;
}

// Fungsi ambil jawaban dari intent
async function getResponse(message) {
    const response = await manager.process('id', message);
    if (response.answer) return response.answer;
    return 'Maaf, aku belum mengerti maksudmu. Coba gunakan /help untuk daftar perintah.';
}

module.exports = { predictIntent, getResponse };