const OpenAI = require('openai');

let client;

function getClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
      timeout: 30000
    });
  }
  return client;
}

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
      model: 'gemini/gemini-2.5-flash', // 🔥 PENTING
      messages: [{ role: 'user', content: prompt }],
      temperature: 0
    });

    const intent = response.choices[0].message.content
      .trim()
      .toUpperCase();

    const allowed = [
      'ABSEN',
      'RIWAYAT',
      'STATUS',
      'APPROVE',
      'EXPORT',
      'REVISI'
    ];

    return allowed.includes(intent) ? intent : 'UNKNOWN';

  } catch (err) {
    console.error('[IntentAI Error]', err.message);
    return 'UNKNOWN';
  }
};
