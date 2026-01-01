const OpenAI = require('openai');

let client; // lazy init

function getClient() {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY belum tersedia');
    }

    if (!process.env.OPENAI_BASE_URL) {
      throw new Error('OPENAI_BASE_URL belum tersedia');
    }

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

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // atau tanya provider: model apa yg tersedia
      messages: [
        {
          role: 'system',
          content: 'Kamu adalah intent classifier bot WhatsApp absensi.'
        },
        {
          role: 'user',
          content: text
        }
      ],
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

  } catch (error) {
    console.error('[IntentAI Error]', error.message);
    return 'UNKNOWN';
  }
};
