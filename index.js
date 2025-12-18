// index.js
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const mysql = require('mysql2');
const commands = require('./commands');


// Database setup
const db = mysql.createPool({
  host: '127.0.0.1',          // IPv4
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

// Test DB connection
db.getConnection((err, conn) => {
  if (err) {
    console.error('DB connection failed:', err.message);
    process.exit(1);
  }
  console.log('Database connected!');
  conn.release();
  startWhatsAppBot();
});


// Whatsapp Bot
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

  // QR Login
  client.on('qr', qr => {
    console.log('Scan QR Code untuk login:');
    qrcode.generate(qr, { small: true });
  });

  // Ready
  client.on('ready', () => {
    console.log('Bot WhatsApp ON!');
  });

  // Save or update user info in DB
  function saveOrUpdateUser(wa_number, nama_wa) {
    db.query(
      `INSERT INTO users (wa_number, nama_wa)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         nama_wa = VALUES(nama_wa),
         updated_at = CURRENT_TIMESTAMP`,
      [wa_number, nama_wa],
      err => {
        if (err) console.error('DB save user error:', err.message);
      }
    );
  }

  // Message handler
  client.on('message', async msg => {
    try {
      const chat = await msg.getChat();
      const wa_number = msg.from.replace('@c.us', '');
      const nama = msg._data?.notifyName || 'User';
      const pesan = msg.body?.trim() || '';

      saveOrUpdateUser(wa_number, nama);

      if (commands.message) {
        await commands.message(chat, wa_number, nama, db, pesan);
      } else if (commands.default) {
        await commands.default(chat, nama);
      }
    } catch (err) {
      console.error('Message handling error:', err);
    }
  });

  client.initialize();
}
