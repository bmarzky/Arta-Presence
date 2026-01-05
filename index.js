// index.js
require('dotenv').config();
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const mysql = require('mysql2');
const commands = require('./commands');

//OPEM AI API
console.log('OPENAI KEY:', process.env.OPENAI_API_KEY ? 'TERBACA' : 'TIDAK ADA');
console.log('OPENAI BASE URL:', process.env.OPENAI_BASE_URL || 'TIDAK ADA');

// DB
const db = mysql.createPool({
  host: '127.0.0.1',
  user: 'admin',
  password: 'admin',
  database: 'bot',
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

db.getConnection((err, conn) => {
  if (err) {
    console.error('DB connection failed:', err.message);
    process.exit(1);
  }
  console.log('Database ready!');
  conn.release();
  startWhatsAppBot();
});

// Whatsapp bot
let botStarted = false;

function startWhatsAppBot() {
  if (botStarted) return;
  botStarted = true;

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: 'bot1',
      dataPath: './sessions'
    }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  });

  client.on('qr', qr => {
    console.log('Scan QR Code:');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', () => {
    console.log('Arta is online.');
  });

  const startReminder = require('./commands/absensi/cronReminder');

  client.on('ready', () => {
    console.log('Arta is online.');
    startReminder(client, db);
  });

  // Message handdler
  client.on('message', async msg => {
      try {
          const chat = await msg.getChat();
          const wa_number = msg.from.replace('@c.us', '');
          const nama = msg._data?.notifyName || 'User';
          const pesan = msg.body?.trim() || '';

          // Ambil media jika ada
          let messageMedia = null;
          if (msg.hasMedia) {
              messageMedia = await msg.downloadMedia();
          }

          // Panggil module message dengan 6 parameter
          if (commands.message) {
              await commands.message(chat, wa_number, nama, db, pesan, messageMedia);
          }
      } catch (err) {
          console.error('Message handling error:', err);
      }
  });

  client.initialize();
}
