// middleware/auth.js
const { auth } = require('express-oauth2-jwt-bearer');
const jwt = require('jsonwebtoken');

// Configuration de l'authentification Auth0
const checkJwt = auth({
  audience: process.env.AUTH0_AUDIENCE,
  issuerBaseURL: process.env.AUTH0_DOMAIN,
});

// Middleware pour vérifier le rôle de l'utilisateur
const checkRole = (requiredRole) => {
  return async (req, res, next) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      
      if (!token) {
        return res.status(401).json({ message: 'Token non fourni' });
      }
      
      const decodedToken = jwt.decode(token);
      
      if (!decodedToken) {
        return res.status(401).json({ message: 'Token invalide' });
      }
      
      // Vérifier le rôle dans les permissions du token
      const userRole = decodedToken['https://votre-domaine.com/roles'] || 'client';
      
      if (requiredRole === 'admin' && userRole !== 'admin') {
        return res.status(403).json({ message: 'Accès non autorisé' });
      }
      
      // Stocker l'ID Auth0 pour une utilisation ultérieure
      req.auth0Id = decodedToken.sub;
      req.userRole = userRole;
      
      next();
    } catch (error) {
      console.error('Erreur lors de la vérification du rôle:', error);
      res.status(401).json({ message: 'Non autorisé' });
    }
  };
};

module.exports = {
  checkJwt,
  checkRole
};