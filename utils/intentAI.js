const OpenAI = require('openai');

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Detect intent user menggunakan AI
 * @param {string} text
 * @returns {Promise<'ABSEN'|'RIWAYAT'|'STATUS'|'APPROVE'|'EXPORT'|'REVISI'|'UNKNOWN'>}
 */
module.exports = async function detectIntentAI(text) {
  try {
    const prompt = `
Kamu adalah intent classifier untuk bot WhatsApp absensi kantor.

Tentukan SATU intent dari daftar berikut:
- ABSEN : user ingin absen / hadir / presensi
- RIWAYAT : user ingin melihat riwayat absensi atau laporan
- STATUS : user ingin mengecek status laporan / approval
- APPROVE : atasan ingin menyetujui laporan
- EXPORT : user ingin export / download laporan
- REVISI : atasan ingin revisi laporan
- UNKNOWN : jika tidak jelas

Pesan user:
"${text}"

Balas HANYA dengan satu kata intent (huruf kapital).
`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0
    });

    const intent = response.choices[0].message.content
      .trim()
      .toUpperCase();

    // Validasi biar aman
    const allowedIntents = [
      'ABSEN',
      'RIWAYAT',
      'STATUS',
      'APPROVE',
      'EXPORT',
      'REVISI'
    ];

    if (!allowedIntents.includes(intent)) {
      return 'UNKNOWN';
    }

    return intent;

  } catch (error) {
    console.error('[IntentAI Error]', error.message);
    return 'UNKNOWN';
  }
};
