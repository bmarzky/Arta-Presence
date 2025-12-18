// index.js
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const mysql = require('mysql2');
const commands = require('./commands');
const moment = require('moment');

// DATABASE (POOL - STABLE)
const db = mysql.createPool({
  host: '127.0.0.1',
  user: 'admin',
  password: 'admin',
  database: 'bot',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test koneksi DB
db.getConnection((err, conn) => {
  if (err) {
    console.error('DB connection error:', err);
    process.exit(1);
  } else {
    console.log('Database connected!');
    conn.release();
    startWhatsAppBot();
  }
});


// WHATSAPP CLIENT
function startWhatsAppBot() {
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

  // QR Code
  client.on('qr', qr => {
    console.log('Scan QR Code untuk login:');
    qrcode.generate(qr, { small: true });
  });

  // Bot siap
  client.on('ready', () => {
    console.log('Bot WhatsApp ON!');
  });

  // SIMPAN / UPDATE USER
  function saveOrUpdateUser(wa_number, nama_wa) {
    db.query(
      `INSERT INTO users (wa_number, nama_wa)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         nama_wa = VALUES(nama_wa),
         updated_at = CURRENT_TIMESTAMP`,
      [wa_number, nama_wa],
      err => {
        if (err) console.error('Error saveOrUpdateUser:', err);
      }
    );
  }

  // PESAN MASUK
  client.on('message', async msg => {
    try {
      const chat = await msg.getChat();
      const wa_number = msg.from.replace('@c.us', '');
      const nama = msg._data.notifyName || 'User';
      const pesan = msg.body.trim();

      // Simpan user
      saveOrUpdateUser(wa_number, nama);

      // Jalankan command
      if (commands.message) {
        await commands.message(chat, wa_number, nama, db, pesan);
      } else if (commands.default) {
        await commands.default(chat, nama);
      }
    } catch (err) {
      console.error('Error handling message:', err);
    }
  });

  // Init WA
  client.initialize();
}
