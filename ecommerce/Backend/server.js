const app = require('./app');
const http = require('http');
const mysql = require('mysql2/promise');
const config = require('./config/database');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

// Connexion à la base de données avant de démarrer le serveur
async function startServer() {
  try {
    // Créer une connexion à la base de données
    const connection = await mysql.createConnection({
      host: config.host,
      user: config.user,
      password: config.password,
      database: config.database
    });
    
    console.log('Connexion à la base de données établie avec succès');
    connection.end();
    
    // Démarrer le serveur
    server.listen(PORT, () => {
      console.log(`Serveur démarré sur le port ${PORT}`);
    });
  } catch (error) {
    console.error('Erreur lors de la connexion à la base de données:', error);
    process.exit(1);
  }
}

startServer();