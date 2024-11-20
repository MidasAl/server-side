const logger = require('../config/logger');

function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        logger.error('Authentication failed: No session userId');
        res.status(401).json({ message: 'Not authenticated' });
    }
}

module.exports = {
    isAuthenticated
};