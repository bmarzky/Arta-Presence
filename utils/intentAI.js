const OpenAI = require('openai');

let client; // ← lazy init

function getClient() {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY belum tersedia');
    }

    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }
  return client;
}

/**
 * Detect intent user menggunakan AI
 * @param {string} text
 * @returns {Promise<'ABSEN'|'RIWAYAT'|'STATUS'|'APPROVE'|'EXPORT'|'REVISI'|'UNKNOWN'>}
 */
module.exports = async function detectIntentAI(text) {
  try {
    const openai = getClient();

    const prompt = `
Kamu adalah intent classifier untuk bot WhatsApp absensi kantor.

Tentukan SATU intent dari daftar berikut:
- ABSEN
- RIWAYAT
- STATUS
- APPROVE
- EXPORT
- REVISI
- UNKNOWN

Pesan user:
"${text}"

Balas HANYA dengan satu kata intent (huruf kapital).
`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0
    });

    const intent = response.choices[0].message.content
      .trim()
      .toUpperCase();

    const allowedIntents = [
      'ABSEN',
      'RIWAYAT',
      'STATUS',
      'APPROVE',
      'EXPORT',
      'REVISI'
    ];

    return allowedIntents.includes(intent) ? intent : 'UNKNOWN';

  } catch (error) {
    console.error('[IntentAI Error]', error.message);
    return 'UNKNOWN';
  }
};
